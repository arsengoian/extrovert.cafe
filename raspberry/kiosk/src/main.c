/* main.c — kiosk: композитор поверх SVG-шаблонів (меню, реклама,
 * панель бонусів) і прямого Cairo (смуга прогресу, попап).
 *
 *   URL=... POINT=kyiv-01 ASSETS=./assets DESKTOP_FRAMES=180 ./bin/kiosk-desktop
 *
 * DESKTOP_FRAMES>0 — вихід після N кадрів і дамп PNG (тестовий режим,
 * дивись build/run-desktop.sh). Без нього — цикл нескінченний, як і
 * призначено для кіоска.
 */
#include "config.h"
#include "menu.h"
#include "render.h"
#include "gl.h"
#include "platform.h"
#include "telemetry.h"
#include "bonus.h"
#include "popup.h"
#include "update.h"
#include "selftest.h"

#include <fontconfig/fontconfig.h>
#include <curl/curl.h>
#include "ws.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <signal.h>
#include <math.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/resource.h>   /* setpriority — фоновий рендер поступається кадру */

static volatile sig_atomic_t g_running = 1;
static volatile sig_atomic_t g_popup_toggle = 0;
static volatile sig_atomic_t g_dump_requested = 0;

static void on_sigterm(int sig) { (void)sig; g_running = 0; }
static void on_sigusr1(int sig) { (void)sig; g_popup_toggle = 1; }  /* показати/сховати демо-попап */
static void on_sigusr2(int sig) { (void)sig; g_dump_requested = 1; }  /* знімок живого кадру на вимогу */

/* Різниця двох міток у секундах — для розкладки часу рендера в лозі. */
static double span(struct timespec s0, struct timespec s1) {
    return (double)(s1.tv_sec - s0.tv_sec) + (double)(s1.tv_nsec - s0.tv_nsec) / 1e9;
}

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

/* Реєструє реальні .ttf як прикладні шрифти для Pango/fontconfig у цьому
 * процесі — не системна інсталяція, так само точково, як лого вставляється
 * через scripts/embed-logo.mjs, а не переписуванням системи. */
static void load_fonts(const char *assets_dir) {
    /* Extro* — кожна вага своя "родина" (файл названо як окрему family,
     * а не одна family з кількома вагами) — так простіше й надійніше
     * підбирати шрифт за буквальною назвою в font_spec, без покладання
     * на те, що fontconfig правильно розв'яже вагу. Extro1000 доданий
     * 29.08.2026 для заголовка реклами (AD_HEAD_FONT_SIZE, config.h). */
    const char *names[] = { "Extro400", "Extro600", "Extro700", "Extro900", "Extro1000" };
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        char path[1024];
        snprintf(path, sizeof(path), "%s/fonts/%s.ttf", assets_dir, names[i]);
        if (!FcConfigAppFontAddFile(FcConfigGetCurrent(), (const FcChar8 *)path))
            fprintf(stderr, "main: не вдалось підвантажити шрифт %s\n", path);
    }

    /* Poppins — звичайний Google Fonts файл: ОДНА typographic family
     * "Poppins" із трьома встановленими вагами. На відміну від Extro*,
     * тут покладаємось на fontconfig, щоб підібрати найближчу вагу за
     * font_spec "Poppins <вага> <розмір>" (config.h: FONT_POPPINS). */
    const char *poppins[] = { "Poppins-Regular", "Poppins-SemiBold", "Poppins-Bold" };
    for (size_t i = 0; i < sizeof(poppins) / sizeof(poppins[0]); i++) {
        char path[1024];
        snprintf(path, sizeof(path), "%s/fonts/%s.ttf", assets_dir, poppins[i]);
        if (!FcConfigAppFontAddFile(FcConfigGetCurrent(), (const FcChar8 *)path))
            fprintf(stderr, "main: не вдалось підвантажити шрифт %s\n", path);
    }
}

/* popIn .34s ease-out / popOut .28s ease-in — квадратичні наближення
 * досить помітно відрізняють "влітає" від "лінійно їде". */
/* Статична картинка меню для запасного варіанта (docs/raspberry-pi.md §6):
 * fbi малює її у фреймбуфер ПІД dispmanx-шаром кіоска, тож її видно до
 * першого кадру після завантаження і якщо кіоск не піднявся взагалі.
 * Пишемо самі, коли змінюється меню (menu_poll віддає лише зміни, тож це
 * рідко й карти не зношує), — інакше ціни в запасній картинці міняв би
 * хтось руками через scp. Меню з рекламою, без панелі бонусів і попапів:
 * вигадані QR у статичній картинці нікому не потрібні. Через .tmp і
 * rename — щоб знеструмлення посеред запису не лишило битий PNG. */
static void write_fallback_png(cairo_surface_t *menu_s, cairo_surface_t *ad_s, cairo_surface_t *prices_s,
                               unsigned long hash, bool temporary) {
    const char *path = getenv("FALLBACK_PNG");
    if (!path || !path[0] || !menu_s) return;
    /* Знижені ціни живуть хвилину-дві. Запасна картинка має показувати
     * звичайні: якщо кіоск упаде посеред знижки, під ним висіли б ціни,
     * яких уже немає. Повні ціни на неї потраплять, щойно знижка мине. */
    if (temporary) { fprintf(stderr, "main: меню зі знижкою — запасну картинку не чіпаю\n"); return; }
    /* Поруч із картинкою лежить хеш меню, з якого її намальовано. Збігається
     * і сам файл на місці — писати нічого: та сама картинка вже там.
     * Коштує це 7,1 с на ARMv6 (заміряно на точці 25.09.2026), і платили ми
     * їх на КОЖНОМУ старті кіоска, тобто на кожному релізі — у той самий
     * момент, коли процесор і так ділиться між старою копією, що малює, і
     * новою, що піднімається. */
    char hpath[1100];
    snprintf(hpath, sizeof(hpath), "%s.hash", path);
    char want[32];
    snprintf(want, sizeof(want), "%lu", hash);
    if (hash) {
        FILE *hf = fopen(hpath, "r");
        if (hf) {
            char had[32] = {0};
            bool same = fgets(had, sizeof(had), hf) && strcmp(had, want) == 0 && access(path, R_OK) == 0;
            fclose(hf);
            if (same) { fprintf(stderr, "main: запасна картинка вже від цього меню — не переписую\n"); return; }
        }
    }
    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, STAGE_W, STAGE_H);
    cairo_t *cr = cairo_create(s);
    cairo_set_source_surface(cr, menu_s, 0, 0);
    cairo_paint(cr);
    if (prices_s) { cairo_set_source_surface(cr, prices_s, PRICES_X, PRICES_Y); cairo_paint(cr); }
    if (ad_s) { cairo_set_source_surface(cr, ad_s, PANEL_X, AD_Y); cairo_paint(cr); }

    /* Мітка «це запасна картинка»: чотири білі крапки по кутах.
     * Запасне меню намальоване тим самим кодом, що й живе, тож на екрані їх
     * не відрізнити — а різниця величезна: під картинкою кіоск може бути
     * мертвий, і ціни на ній застигли тим, чим були (прохання власника
     * 24.09.2026). Крапка 2 px у кутку 1080p — це те, що видно, лише коли
     * знаєш, куди дивитись. */
    cairo_set_source_rgb(cr, 1, 1, 1);
    for (int i = 0; i < 4; i++) {
        double x = (i & 1) ? STAGE_W - FALLBACK_MARK_PX - FALLBACK_MARK_INSET : FALLBACK_MARK_INSET;
        double y = (i & 2) ? STAGE_H - FALLBACK_MARK_PX - FALLBACK_MARK_INSET : FALLBACK_MARK_INSET;
        cairo_rectangle(cr, x, y, FALLBACK_MARK_PX, FALLBACK_MARK_PX);
    }
    cairo_fill(cr);
    cairo_destroy(cr);
    /* pid у назві: при overlap-підміні дві копії кіоска стартують разом і
     * обидві пишуть картинку — спільний .tmp вони б зіпсували одна одній. */
    char tmp[1024];
    snprintf(tmp, sizeof(tmp), "%s.%d.tmp", path, (int)getpid());
    /* Час пишемо завжди, а не лише у фоновому рендері: там рядок зʼявляється
     * тільки коли змінилось меню, тобто раз на кілька днів, а тут — на
     * кожному старті кіоска. Вісім мегабайтів ARGB через zlib на ARMv6 —
     * головний підозрюваний у тих 32,8 с (25.09.2026). */
    struct timespec p0, p1;
    clock_gettime(CLOCK_MONOTONIC, &p0);
    bool written = cairo_surface_write_to_png(s, tmp) == CAIRO_STATUS_SUCCESS && rename(tmp, path) == 0;
    clock_gettime(CLOCK_MONOTONIC, &p1);
    if (written) {
        /* Хеш кладемо ПІСЛЯ картинки: обірветься живлення між ними — наступний
         * старт просто перепише картинку, а не повірить у застарілу. */
        FILE *hf = fopen(hpath, "w");
        if (hf) { fprintf(hf, "%s", want); fclose(hf); }
        fprintf(stderr, "main: запасна картинка → %s за %.1f с\n", path, span(p0, p1));
    } else
        fprintf(stderr, "main: запасна картинка не записалась (%s)\n", path);
    cairo_surface_destroy(s);
}

/* Перший рендер меню, реклами й шару цін у текстури — на старті. Поверхні
 * меню й реклами не знищуються, а віддаються через keep_*: потік меню
 * тримає їх, щоб, коли зміняться лише ціни, скласти з ними запасну
 * картинку без повторного рендеру всього меню. */
static void apply_menu(const menu_t *menu, const char *assets_dir,
                       gl_texture_t *menu_tex, gl_texture_t *ad_tex, gl_texture_t *prices_tex,
                       cairo_surface_t **keep_menu, cairo_surface_t **keep_ad) {
    cairo_surface_t *m = render_menu(menu, assets_dir);
    cairo_surface_t *a = render_ad(menu, assets_dir);
    cairo_surface_t *p = render_prices(menu, assets_dir);
    if (m) {
        if (getenv("DEBUG_CAIRO_PNG")) cairo_surface_write_to_png(m, getenv("DEBUG_CAIRO_PNG"));
        gl_texture_destroy(menu_tex);
        *menu_tex = gl_texture_from_cairo(m);
    }
    gl_texture_destroy(ad_tex);
    if (a) *ad_tex = gl_texture_from_cairo(a);
    gl_texture_destroy(prices_tex);
    if (p) *prices_tex = gl_texture_from_cairo(p);
    write_fallback_png(m, a, p, menu_visible_hash(menu), menu->discount);
    if (p) cairo_surface_destroy(p);
    *keep_menu = m;
    *keep_ad = a;
}

static double ease_out(double x) { return 1.0 - (1.0 - x) * (1.0 - x); }
static double ease_in(double x)  { return x * x; }

typedef enum { POPUP_HIDDEN, POPUP_IN, POPUP_SHOWN, POPUP_OUT } popup_state_t;

/* Опитування меню — на окремому потоці, а не в кадровому циклі.
 * Вимір телеметрією 30.08.2026 на реальному Pi: menu_poll() усередині
 * while(g_running) дав кадр 13,5 СЕКУНДИ (CURLOPT_TIMEOUT=15 у menu.c) —
 * curl_easy_perform() блокує, а більше нічого в циклі не малюється, поки
 * він не поверне контроль. Екран кіоска на цей час просто завмирає.
 * menu_t — POD (жодних вказівників, самі char[]/int/bool, menu.h), тому
 * безпечно копіюється між потоками під мʼютексом без глибокого клону. */
typedef struct {
    pthread_mutex_t mu;
    menu_t last;         /* остання бачена потоком менюшка — і джерело хеша
                           * для дедуп-виходу в menu_poll (out->hash) */
    menu_t pending;      /* нова менюшка, разом із уже намальованими
                           * поверхнями: головному потоку лишається тільки
                           * залити їх у текстуру */
    bool has_pending;
    /* Малюємо ТУТ, у фоновому потоці. Раніше цим займався кадровий цикл, і
     * render_menu() на Pi 1 (~8 с) щоразу морозив екран — рівно тоді, коли
     * приїхали нові ціни, тобто коли на кіоск і дивляться (docs/raspberry-pi.md
     * §7, виправлено 24.09.2026). Cairo тут безпечний: до старту потоку
     * перший рендер робить main, після — лише цей потік, а головному
     * дістається готова поверхня під мʼютексом. GL лишається там, де був:
     * контекст у головного потоку, і ділити його ні з ким не можна. */
    cairo_surface_t *pending_menu;
    cairo_surface_t *pending_ad;
    /* Шар цін — окремо (render_prices). pending_base: разом із ним
     * приїхали й нові меню з рекламою; false — змінились лише ціни, і
     * головний потік міняє тільки текстуру цін. */
    cairo_surface_t *pending_prices;
    bool pending_base;
    /* Останні намальовані меню й реклама — лише для потоку меню (після
     * старту): з ними й новим шаром цін складається запасна картинка,
     * коли ціни змінились, а решта ні. Свої посилання (cairo_surface_reference),
     * текстури з них головний потік уже залив. */
    cairo_surface_t *base_menu;
    cairo_surface_t *base_ad;
    const char *url;
    const char *assets_dir;
    volatile sig_atomic_t stop;
    /* Подія menu.deployed (головний потік кладе сюди номер деплою під
     * мʼютексом): не чекати кінця хвилини, а перечитати меню одразу — з
     * ?v=<номер>, щоб кеш бакета (max-age=30) не віддав старе тіло. 0 —
     * поштовху немає. До 27.09.2026 кіоск цю подію відкидав, і нові ціни
     * їхали на екран до півтори хвилини. */
    long long poke;
    /* Куди підтвердити, що меню деплою на екрані (acked_at в адмінці), і
     * чим. Порожньо — не підтверджуємо (десктоп без токена). */
    const char *ack_url;
    const char *token;
} menu_poller_t;

static void *menu_poll_thread(void *arg) {
    menu_poller_t *mp = (menu_poller_t *)arg;
    /* Поступаємось кадровому циклу. Ядро на Pi 1 одне, і робота цього потоку
     * (rsvg, cairo, zlib) рівно та сама за природою, що й малювання кадру —
     * планувальник ділить процесор порівну й уповільнює обох. Заміряно
     * 25.09.2026: меню коштує 5,5 с, картинка 7,1 с, а у фоні разом виходило
     * 32,8 с — решта це чиста конкуренція.
     *
     * nice тут безпечний саме тому, що на цей потік ніхто не дивиться: меню
     * оновлюється раз на кілька днів, і якщо воно намалюється на пів
     * хвилини пізніше, не помітить ніхто. А от просілі кадри на екрані
     * помітно одразу.
     *
     * PRIO_PROCESS із who=0 у Linux означає саме ПОТІК, що викликав, а не
     * весь процес — це давня особливість ядра, і тут вона якраз доречна. */
    if (setpriority(PRIO_PROCESS, 0, 10) != 0)
        fprintf(stderr, "main: не вийшло знизити пріоритет потоку меню\n");
    /* Який деплой уже підтвердили api. Підтверджуємо той, з якого меню на
     * екрані, — хоч прийшло воно подією, хоч опитуванням, хоч із кешу на
     * старті. Не вдалось (мережа) — спробуємо на наступному колі. */
    long long acked = 0;
    for (;;) {
        pthread_mutex_lock(&mp->mu);
        menu_t attempt = mp->last;
        pthread_mutex_unlock(&mp->mu);
        /* Те, що зараз на екрані: з ним порівнюємо нове меню, щоб знати,
         * чи досить перемалювати лише ціни. */
        const menu_t shown = attempt;

        if (attempt.deployment_id > 0 && attempt.deployment_id != acked &&
            menu_ack(mp->ack_url, mp->token, attempt.deployment_id))
            acked = attempt.deployment_id;

        /* Чекаємо refreshSec, перевіряючи stop кожні 100мс, а не суцільним
         * sleep(refresh_s) — інакше зупинка (SIGTERM) чекала б до хвилини. */
        /* Поки жодного меню ще не було — часто: після знеструмлення кіоск
         * стартує раніше, ніж піднімається мережа (21.09.2026 перший запит
         * падав щоразу), і чекати звичайну хвилину до другої спроби —
         * хвилина порожнього кадру замість меню. */
        int refresh_s = !attempt.valid ? MENU_RETRY_S
                      : attempt.refresh_sec > 0 ? attempt.refresh_sec : 60;
        /* Чекання обривається раніше у двох випадках: прийшла подія
         * menu.deployed (poke) або скінчилась знижка — тоді ціни треба
         * повернути, не чекаючи ні опитування, ні деплою повернення. */
        long long poke = 0;
        for (int waited = 0; waited < refresh_s * 10 && !mp->stop; waited++) {
            pthread_mutex_lock(&mp->mu);
            poke = mp->poke;
            mp->poke = 0;
            pthread_mutex_unlock(&mp->mu);
            if (poke) break;
            if (attempt.discount && (long long)time(NULL) >= attempt.discount_until) break;
            usleep(100000);
        }
        if (mp->stop) break;

        bool changed;
        if (poke) {
            char url[1400];
            snprintf(url, sizeof(url), "%s%sv=%lld", mp->url, strchr(mp->url, '?') ? "&" : "?", poke);
            changed = menu_poll(url, &attempt);
            fprintf(stderr, "main: menu.deployed %lld — меню перечитано одразу (%s)\n",
                    poke, changed ? "нове" : menu_last_poll_ok() ? "те саме" : "не вдалось");
        } else if (attempt.discount && (long long)time(NULL) >= attempt.discount_until) {
            changed = false;   /* нічого не питаємо — лише повертаємо повні ціни нижче */
        } else {
            changed = menu_poll(mp->url, &attempt);
        }
        /* Знижка могла вже минути — і в щойно прочитаному тілі теж (подія
         * запізнилась, кеш): тоді одразу повні ціни. */
        bool expired = menu_expire_discount(&attempt, (long long)time(NULL));
        if (expired) fprintf(stderr, "main: знижка скінчилась — повертаю повні ціни\n");
        /* Нове меню з деплою — одразу підтверджуємо, не чекаючи кола. */
        if (changed && attempt.deployment_id > 0 && attempt.deployment_id != acked &&
            menu_ack(mp->ack_url, mp->token, attempt.deployment_id))
            acked = attempt.deployment_id;

        /* Змінились лише ціни (знижка, її кінець, звичайна зміна цін) — і
         * меню вже намальоване: перемальовуємо тільки шар цін. Так знижка
         * з'являється за частку секунди, а не через ~22 с, які Pi 1 малює
         * все меню (28.09.2026). */
        if ((changed || expired) && mp->base_menu && menu_same_look(&shown, &attempt)) {
            struct timespec t0, tp, t1;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            cairo_surface_t *p = render_prices(&attempt, mp->assets_dir);
            clock_gettime(CLOCK_MONOTONIC, &tp);

            /* Спершу на екран, потім запасна картинка: її запис на Pi 1
             * коштує ~13 с, і першого дня повні ціни після знижки чекали
             * саме його (лог kyiv-01, 28.09.2026). Своє посилання на шар —
             * головний потік знищить свій, щойно заллє текстуру. */
            if (p) cairo_surface_reference(p);
            pthread_mutex_lock(&mp->mu);
            mp->last = attempt;
            mp->pending = attempt;
            /* Повне меню, яке головний потік ще не забрав, лишається в
             * черзі (pending_base) — інакше загубилось би. */
            if (mp->pending_prices) cairo_surface_destroy(mp->pending_prices);
            mp->pending_prices = p;
            mp->has_pending = true;
            pthread_mutex_unlock(&mp->mu);

            write_fallback_png(mp->base_menu, mp->base_ad, p, menu_visible_hash(&attempt), attempt.discount);
            if (p) cairo_surface_destroy(p);
            clock_gettime(CLOCK_MONOTONIC, &t1);

            fprintf(stderr, "main: лише ціни у фоні: на екран за %.2f с, запасний png ще %.1f с%s\n",
                    span(t0, tp), span(tp, t1), attempt.discount ? " — знижка" : "");
        } else if (changed || expired) {
            struct timespec t0, t1;
            /* Три заміри, а не один. Загальні 32,8 с у лозі точки нічого не
             * пояснювали: selftest тим часом малює те саме меню за 5,5 с, і
             * без розкладки не видно, чи винен rsvg, чи запис
             * 8-мегабайтної картинки в PNG на ARMv6 (25.09.2026). */
            struct timespec tm, ta, tp;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            cairo_surface_t *m = render_menu(&attempt, mp->assets_dir);
            clock_gettime(CLOCK_MONOTONIC, &tm);
            cairo_surface_t *a = render_ad(&attempt, mp->assets_dir);
            clock_gettime(CLOCK_MONOTONIC, &ta);
            cairo_surface_t *p = render_prices(&attempt, mp->assets_dir);
            clock_gettime(CLOCK_MONOTONIC, &tp);

            /* Свої посилання на меню й рекламу — для наступної зміни лише
             * цін. Не вдалось намалювати меню — лишаємо попереднє: на
             * екрані теж лишиться старе (головний потік NULL не заливає). */
            if (m) {
                if (mp->base_menu) cairo_surface_destroy(mp->base_menu);
                if (mp->base_ad) cairo_surface_destroy(mp->base_ad);
                mp->base_menu = cairo_surface_reference(m);
                mp->base_ad = a ? cairo_surface_reference(a) : NULL;
            }
            /* Шар цін потрібен і запасній картинці, яку пишемо вже після
             * того, як віддали все на екран (нижче). */
            if (p) cairo_surface_reference(p);

            pthread_mutex_lock(&mp->mu);
            mp->last = attempt;
            mp->pending = attempt;
            /* Попередню, яку головний потік не встиг забрати, звільняємо тут:
             * інакше кожне друге оновлення меню лишало б по 8 МБ. */
            if (mp->pending_menu) cairo_surface_destroy(mp->pending_menu);
            if (mp->pending_ad) cairo_surface_destroy(mp->pending_ad);
            if (mp->pending_prices) cairo_surface_destroy(mp->pending_prices);
            mp->pending_menu = m;
            mp->pending_ad = a;
            mp->pending_prices = p;
            mp->pending_base = true;
            mp->has_pending = true;
            pthread_mutex_unlock(&mp->mu);

            write_fallback_png(m ? mp->base_menu : NULL, mp->base_ad, p, menu_visible_hash(&attempt), attempt.discount);
            if (p) cairo_surface_destroy(p);
            clock_gettime(CLOCK_MONOTONIC, &t1);

            fprintf(stderr,
                    "main: меню у фоні за %.1f с (меню %.1f + реклама %.1f + ціни %.2f + запасний png %.1f) — кадр не стояв\n",
                    span(t0, t1), span(t0, tm), span(tm, ta), span(ta, tp), span(tp, t1));
        }
    }
    return NULL;
}

int main(int argc, char **argv) {
    const char *url = getenv("URL");
    if (!url) url = "https://pos.extrovert.cafe/points/kyiv-01/menu.json";
    const char *assets_dir = getenv("ASSETS");
    if (!assets_dir) assets_dir = "./assets";
    const char *sock_path = getenv("TELEMETRY_SOCK");
    if (!sock_path) sock_path = "/tmp/kiosk.sock";
    int desktop_frames = getenv("DESKTOP_FRAMES") ? atoi(getenv("DESKTOP_FRAMES")) : 0;
    /* POPUP=1 — попап бонусу з демо-даними раз на POPUP_DEMO_PERIOD_S, щоб
     * було на що дивитись без справжнього чека (SIGUSR1 — разовий ручний
     * показ). Рядок у панелі демо-показ не додає. */
    bool popup_demo = getenv("POPUP") && strcmp(getenv("POPUP"), "1") == 0;

    /* Тека стану, спільна з апдейтером (raspberry/pi/stack/). Порожня змінна —
     * механізм оновлення вимкнено, кіоск поводиться як раніше. */
    const char *state_dir = getenv("EXTROVERT_STATE");
    char update_flag[1024] = {0};
    if (state_dir && state_dir[0])
        snprintf(update_flag, sizeof(update_flag), "%s/updating", state_dir);

    /* --selftest: перевірка "цей бінарник із цими ассетами намалює екран",
     * БЕЗ дисплея — щоб апдейтер міг випробувати нову версію, поки стару
     * ще видно на екрані (selftest.h пояснює, чому інакше не можна). */
    bool selftest = false;
    for (int i = 1; i < argc; i++)
        if (strcmp(argv[i], "--selftest") == 0) selftest = true;
    if (selftest) {
        load_fonts(assets_dir);
        const char *out = getenv("SELFTEST_PNG");
        return selftest_run(assets_dir, out && out[0] ? out : NULL);
    }

    signal(SIGTERM, on_sigterm);
    signal(SIGINT, on_sigterm);
    signal(SIGUSR1, on_sigusr1);
    signal(SIGUSR2, on_sigusr2);

    fprintf(stderr, "main: старт, url=%s\n", url); fflush(stderr);
    curl_global_init(CURL_GLOBAL_DEFAULT);

    /* Події точки. Адреса за замовчуванням прошита збіркою: десктопна ціль
     * дивиться в локальний ws, малинова — одразу в прод (Makefile,
     * WS_DEFAULT_URL). Без WS_TOKEN справжнього каналу немає, і кіоск
     * лишається на емуляції — так само, як було до появи ws.c. */
    const char *ws_url = getenv("WS_URL");
    if (!ws_url || !ws_url[0]) ws_url = WS_DEFAULT_URL;
    /* Токен: або прямо в оточенні, або файлом. На точці це файл —
     * config/point.key поза релізом, щоб ключ можна було замінити, не
     * перевикочуючи кіоск, і щоб він не поїхав у публічний архів релізу
     * (docs/raspberry-pi.md §2). */
    char token_buf[2048] = {0};
    const char *ws_token = getenv("WS_TOKEN");
    const char *token_file = getenv("WS_TOKEN_FILE");
    if ((!ws_token || !ws_token[0]) && token_file && token_file[0]) {
        FILE *tf = fopen(token_file, "r");
        if (tf) {
            if (fgets(token_buf, sizeof(token_buf), tf)) {
                token_buf[strcspn(token_buf, "\r\n")] = '\0';
                ws_token = token_buf;
            }
            fclose(tf);
        } else {
            fprintf(stderr, "main: WS_TOKEN_FILE %s не читається\n", token_file);
        }
    }

    /* Знімок стану точки після кожного підключення: без нього bonus_ready,
     * опублікований у мить перепідключення, не побачить ніхто, і людина
     * стоятиме біля машини з чеком, а QR на екрані не буде. */
    char state_url[256] = {0};
    const char *api_url = getenv("API_URL");
    if (!api_url || !api_url[0]) api_url = API_DEFAULT_URL;
    const char *point = getenv("POINT");
    if (api_url[0] && point && point[0]) {
        size_t n = strlen(api_url);
        snprintf(state_url, sizeof(state_url), "%s%spoints/%s/state",
                 api_url, (n && api_url[n - 1] == '/') ? "" : "/", point);
    } else {
        fprintf(stderr, "main: без POINT знімка стану не буде — лише події ws\n");
    }

    /* Підтвердження меню деплою: той самий api і той самий токен точки. */
    char ack_url[256] = {0};
    if (api_url[0] && point && point[0]) {
        size_t n = strlen(api_url);
        snprintf(ack_url, sizeof(ack_url), "%s%spoints/%s/menu/ack",
                 api_url, (n && api_url[n - 1] == '/') ? "" : "/", point);
    }

    ws_client_t *ws = NULL;
    if (ws_token && ws_token[0]) {
        ws = ws_start(ws_url, ws_token, state_url);
    } else {
        fprintf(stderr, "main: WS_TOKEN не заданий — бонуси емулюються (bun scripts/point-token.mjs <point>)\n");
    }
    fprintf(stderr, "main: curl_global_init ok, вантажу шрифти...\n"); fflush(stderr);
    load_fonts(assets_dir);
    fprintf(stderr, "main: шрифти ok, platform_init...\n"); fflush(stderr);

    platform_t *plat = platform_init(STAGE_W, STAGE_H);
    if (!plat) { fprintf(stderr, "main: platform_init провалився\n"); return 1; }

    gl_compositor_t comp;
    if (!gl_compositor_init(&comp, STAGE_W, STAGE_H)) return 1;

    telemetry_t tel;
    telemetry_init(&tel, sock_path);

    menu_t menu = {0};
    gl_texture_t menu_tex = {0};   /* лого + сітка карток — templates/menu.svg */
    gl_texture_t ad_tex = {0};     /* реклама — templates/ad.svg, окремий квад */
    gl_texture_t prices_tex = {0}; /* шар цін — templates/prices.svg, поверх меню */
    cairo_surface_t *base_menu = NULL, *base_ad = NULL;   /* віддаються потоку меню */

    gl_texture_t popup_tex = {0};
    /* Основа попапу рендериться зараз, а не на першому бонусі: на Pi 1 це
     * сотні мілісекунд, і краще їх витратити на старті, ніж на очах у
     * клієнта (popup.h). */
    popup_art_t popup_art = {0};
    popup_art_init(&popup_art, assets_dir);
    /* Затемнення під попапом — текстура 1×1, розтягнута на всю сцену
     * (config.h, POPUP_DIM_A). Непрозора: прозорість задає альфа квада. */
    gl_texture_t dim_tex = {0};
    {
        cairo_surface_t *d = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 1, 1);
        cairo_t *dc = cairo_create(d);
        cairo_set_source_rgb(dc, 0x04 / 255.0, 0x06 / 255.0, 0x08 / 255.0);
        cairo_paint(dc);
        cairo_destroy(dc);
        dim_tex = gl_texture_from_cairo(d);
        cairo_surface_destroy(d);
    }
    /* Плашка "оновлення": своя текстура, що перепікається лише коли
     * змінився стан (update.h), а не щокадру. */
    update_state_t upd;
    update_init(&upd, update_flag);
    gl_texture_t update_tex = {0};
    double update_tex_w = 0;
    /* Плашка «бонуси недоступні» — окрема текстура, але слот на екрані той
     * самий, що в оновлення: двох плашок поруч макет не передбачає, а
     * оновлення важливіше — воно триває хвилину й саме зникне. */
    gl_texture_t offline_tex = {0};
    double offline_tex_w = 0;
    /* Плашка знижки: той самий слот, перепікається, коли змінюється
     * кількість секунд (раз на секунду), і має перевагу над двома іншими. */
    gl_texture_t discount_tex = {0};
    double discount_tex_w = 0;
    int discount_shown = 0;
    double ws_down_since = -1;
    bool offline_shown = false;

    popup_state_t popup_state = POPUP_HIDDEN;
    double popup_t0 = 0;
    double popup_shown_at = 0;   /* коли увійшли в POPUP_SHOWN — для авто-приховування */
    /* Скільки попап стоїть до авто-приховування: звичайний бонус — довго,
     * плашка «Бонус отримано» — пару секунд (config.h). */
    double popup_hold = ANIM_POPUP_HOLD_S;

    /* Перший рендер — синхронно, до входу в цикл: інакше перший кадр
     * малював би порожню сцену, і саме він потрапив би на fps-статистику. */
    if (menu_poll(url, &menu)) {
        fprintf(stderr, "main: меню завантажено, %d напоїв\n", menu.drink_count);
        menu_expire_discount(&menu, (long long)time(NULL));
        apply_menu(&menu, assets_dir, &menu_tex, &ad_tex, &prices_tex, &base_menu, &base_ad);
    } else if (menu_load_cache(&menu)) {
        /* Мережі немає — беремо вчорашню менюшку з диска. Без цього кіоску
         * нема чого малювати, шар лишається прозорим (gl_clear(!have_menu)),
         * і на екрані висить запасна картинка fbi — рівно те, що власник
         * побачив 25.09.2026, увімкнувши точку без кабелю. Ціни в кеші й на
         * тій картинці однаково вчорашні, різниця в тому, що з кешем кіоск
         * живий: малює свій кадр, тримає сокет телеметрії й покаже QR, щойно
         * підніметься ws. */
        fprintf(stderr, "main: мережі немає — меню з кешу, %d напоїв\n", menu.drink_count);
        /* Кеш міг лишитись від меню зі знижкою, яка давно минула. */
        menu_expire_discount(&menu, (long long)time(NULL));
        apply_menu(&menu, assets_dir, &menu_tex, &ad_tex, &prices_tex, &base_menu, &base_ad);
    } else {
        fprintf(stderr, "main: ні мережі, ні кешу (%s) — стартую з порожнім екраном\n", url);
    }

    /* Далі опитування йде фоновим потоком (menu_poll_thread вище) — цей
     * перший виклик лишається синхронним навмисно, той самий сенс, що й
     * у коментарі над ним: перший кадр має вже мати вміст. */
    menu_poller_t poller = {0};
    pthread_mutex_init(&poller.mu, NULL);
    poller.last = menu;
    poller.base_menu = base_menu;
    poller.base_ad = base_ad;
    poller.url = url;
    poller.assets_dir = assets_dir;
    poller.ack_url = ack_url;
    poller.token = ws_token ? ws_token : "";
    /* Щоб SIGTERM під час оновлення не чекав на curl його повний таймаут —
     * деталі в menu.h. */
    menu_set_abort_flag(&poller.stop);
    pthread_t poll_thread;
    pthread_create(&poll_thread, NULL, menu_poll_thread, &poller);

    double t_start = now_s();
    double sim_t = 0;
    long frame_no = 0;

    /* WS ще не підключений (libwebsockets, коли буде готовий протокол/
     * сервер) — bonus_tick_emulate() тимчасово грає його роль. sim_t=0
     * тут навмисно: узгоджено з таймлайном, яким живе решта цього циклу. */
    bonus_state_t bonus;
    bonus_init(&bonus, 0.0, assets_dir);

    /* Демо-цикл (POPUP=1): показати через 1,2 с після старту, далі раз на
     * POPUP_DEMO_PERIOD_S. Ховається попап сам (ANIM_POPUP_HOLD_S), тож
     * цикл лише показує — через той самий g_popup_toggle, що й SIGUSR1. */
    double demo_next_t = 1.2;

    while (g_running) {
        double t_now = now_s();
        sim_t = t_now - t_start;

        /* Забираємо готову менюшку від фонового потоку, якщо вона зʼявилась
         * (menu_poll_thread вище) — сам мережевий виклик тут уже не робимо,
         * лишається тільки Cairo/GL-перерендер, який мілісекунди, не секунди. */
        bool got_new_menu = false;
        menu_t new_menu;
        pthread_mutex_lock(&poller.mu);
        cairo_surface_t *new_menu_surf = NULL, *new_ad_surf = NULL, *new_prices_surf = NULL;
        bool new_base = false;
        if (poller.has_pending) {
            new_menu = poller.pending;
            new_menu_surf = poller.pending_menu; poller.pending_menu = NULL;
            new_ad_surf = poller.pending_ad;     poller.pending_ad = NULL;
            new_prices_surf = poller.pending_prices; poller.pending_prices = NULL;
            new_base = poller.pending_base;      poller.pending_base = false;
            poller.has_pending = false;
            got_new_menu = true;
        }
        pthread_mutex_unlock(&poller.mu);
        if (got_new_menu) {
            menu = new_menu;
            /* Тут лишилось тільки залити готові поверхні в текстури — це
             * кадр, а не вісім секунд. */
            if (new_menu_surf) {
                gl_texture_destroy(&menu_tex);
                menu_tex = gl_texture_from_cairo(new_menu_surf);
                cairo_surface_destroy(new_menu_surf);
            }
            /* Лише ціни — реклама та сама, її текстуру не чіпаємо. */
            if (new_base) {
                gl_texture_destroy(&ad_tex);
                if (new_ad_surf) {
                    ad_tex = gl_texture_from_cairo(new_ad_surf);
                    cairo_surface_destroy(new_ad_surf);
                }
            }
            if (new_prices_surf) {
                gl_texture_destroy(&prices_tex);
                prices_tex = gl_texture_from_cairo(new_prices_surf);
                cairo_surface_destroy(new_prices_surf);
            }
            fprintf(stderr, "main: %s, %d напоїв\n", new_base ? "меню оновлено" : "ціни оновлено", menu.drink_count);
        }

        /* Оновлення: апдейтер створює файл-прапорець перед підміною версії,
         * кіоск показує плашку в шапці й працює далі до самого SIGTERM. */
        update_poll(&upd, update_flag, sim_t);
        /* Бонуси живуть подіями з ws. Немає каналу — QR не зʼявиться, хоч
         * би скільки людина чекала; єдине чесне — сказати це на екрані.
         * ws == NULL (немає токена, десктоп) попередження не вмикає. */
        bool ws_down = ws && !ws_online(ws);
        if (!ws_down) ws_down_since = -1;
        else if (ws_down_since < 0) ws_down_since = sim_t;
        bool bonus_down = ws_down && !upd.active && sim_t - ws_down_since > WS_OFFLINE_GRACE_S;
        if (bonus_down != offline_shown) {
            offline_shown = bonus_down;
            gl_texture_destroy(&offline_tex);
            offline_tex_w = 0;
            if (bonus_down) {
                cairo_surface_t *os = render_update_banner(WS_OFFLINE_LABEL, &offline_tex_w);
                if (os) { offline_tex = gl_texture_from_cairo(os); cairo_surface_destroy(os); }
            }
        }
        {
            long long now_epoch = (long long)time(NULL);
            int left = (menu.discount && now_epoch < menu.discount_until)
                       ? (int)(menu.discount_until - now_epoch) : 0;
            if (left != discount_shown) {
                discount_shown = left;
                gl_texture_destroy(&discount_tex);
                discount_tex_w = 0;
                if (left > 0) {
                    cairo_surface_t *ds = render_discount_banner(left, &discount_tex_w);
                    if (ds) { discount_tex = gl_texture_from_cairo(ds); cairo_surface_destroy(ds); }
                }
            }
        }
        if (upd.dirty) {
            gl_texture_destroy(&update_tex);
            update_tex_w = 0;
            if (upd.active) {
                cairo_surface_t *us = render_update_banner(upd.label, &update_tex_w);
                if (us) { update_tex = gl_texture_from_cairo(us); cairo_surface_destroy(us); }
            }
        }

        if (popup_demo && sim_t >= demo_next_t) {
            if (popup_state == POPUP_HIDDEN) g_popup_toggle = 1;   /* показ, а не «сховати чужий» */
            demo_next_t = sim_t + POPUP_DEMO_PERIOD_S;
        }

        /* Бонус (подія ws або емуляція без токена) додає рядок у панель і,
         * якщо в цей момент екран не зайнятий іншим попапом, показує попап.
         * Рядок у панелі з'являється незалежно від попапу — це вже
         * bonus_update() нижче, не залежить від popup_state. */
        bonus_popup_t bonus_pop = {0};
        bool bonus_arrived = false;
        /* Плашка «Бонус отримано» має право перебити показаний QR-попап:
         * саме його вона й замінює. Звичайний бонус — ні, він чекає, поки
         * екран звільниться. */
        bool bonus_taken = false;

        if (ws) {
            /* Знімок стану точки: приїжджає після кожного (пере)підключення
             * і описує панель цілком. Вирівнюємо по ньому — інакше після
             * обриву на екрані лишився б QR, який уже забрали, і не
             * зʼявився б той, що пробили, поки ми мовчали. */
            ws_snapshot_t snap;
            if (ws_take_snapshot(ws, &snap)) {
                char have[BONUS_MAX_VISIBLE][BONUS_TOKEN_MAX];
                int hn = bonus_tokens(&bonus, have, BONUS_MAX_VISIBLE);
                for (int i = 0; i < hn; i++) {
                    bool still = false;
                    for (int j = 0; j < snap.count && !still; j++)
                        still = strcmp(snap.rows[j].claim_token, have[i]) == 0;
                    /* Плашку «Бонус отримано» тут не показуємо: ми не знаємо,
                     * забрали той QR телефоном чи він просто вигорів, поки
                     * нас не було, — а вітати навмання гірше, ніж мовчати. */
                    if (!still) bonus_mark_taken(&bonus, have[i]);
                }
                for (int j = 0; j < snap.count; j++) {
                    if (bonus_has(&bonus, snap.rows[j].claim_token)) continue;
                    bonus_restore(&bonus, sim_t, &menu, snap.rows[j].code, snap.rows[j].drink,
                                  snap.rows[j].coins, snap.rows[j].claim_token,
                                  snap.rows[j].expires_in_s);
                }
            }

            /* Події зі свого потоку забираємо без блокувань і без мережі —
             * кадр не має чекати на роутер (ws.h). */
            ws_event_t events[8];
            int n = ws_drain(ws, events, 8);
            for (int i = 0; i < n; i++) {
                /* Нове меню на бакеті: поштовх потоку меню (номер деплою —
                 * щоб обійти кеш; без нього — хоч id події). */
                if (strcmp(events[i].event, "menu.deployed") == 0) {
                    pthread_mutex_lock(&poller.mu);
                    poller.poke = events[i].deployment_id ? events[i].deployment_id
                                : events[i].id ? events[i].id : 1;
                    pthread_mutex_unlock(&poller.mu);
                    continue;
                }
                /* Телефон забрав бонус: рядок із панелі геть, а на екрані —
                 * коротка плашка замість QR (config.h, ANIM_POPUP_TAKEN_HOLD_S). */
                if (strcmp(events[i].event, "bonus_taken") == 0) {
                    if (bonus_mark_taken(&bonus, events[i].claim_token)) {
                        bonus_pop = (bonus_popup_t){ .taken = true };
                        bonus_arrived = true;
                        bonus_taken = true;
                    }
                    continue;
                }
                bonus_popup_t p;
                /* Попап показуємо для останньої події пачки: якщо їх
                 * прийшло кілька підряд, миготіти трьома нема сенсу. */
                if (bonus_add_event(&bonus, sim_t, &menu, events[i].code, events[i].drink,
                                    events[i].coins, events[i].claim_token, events[i].items, &p)) {
                    bonus_pop = p;
                    bonus_arrived = true;
                }
            }
        } else {
            bonus_arrived = bonus_tick_emulate(&bonus, sim_t, &menu, &bonus_pop);
        }

        bool show_demo = false;
        if (g_popup_toggle && !bonus_arrived) {
            g_popup_toggle = 0;
            if (popup_state == POPUP_HIDDEN) {
                bonus_demo_popup(&bonus_pop);
                show_demo = true;
            } else if (popup_state == POPUP_SHOWN) {
                popup_state = POPUP_OUT; popup_t0 = sim_t;
            }
        }
        if ((bonus_arrived || show_demo) && (popup_state == POPUP_HIDDEN || bonus_taken)) {
            gl_texture_destroy(&popup_tex);
            cairo_surface_t *ps = popup_render(&popup_art, assets_dir, &bonus_pop);
            if (ps) {
                popup_tex = gl_texture_from_cairo(ps);
                cairo_surface_destroy(ps);
                popup_state = POPUP_IN; popup_t0 = sim_t;
                popup_hold = bonus_taken ? ANIM_POPUP_TAKEN_HOLD_S : ANIM_POPUP_HOLD_S;
            }
            g_popup_toggle = 0;   /* бонус має пріоритет над демо-циклом цього кадру */
        }
        /* Після попапу, не до: на кадрі появи бонусу попап уже в POPUP_IN, і
         * рядок у панелі (SVG + QR, на Pi 1 ~0,3 с) печеться, коли попап
         * проявився й стоїть, а не разом із ним і не посеред анімації. */
        bonus_update(&bonus, sim_t, assets_dir,
                     popup_state != POPUP_IN && popup_state != POPUP_OUT);
        if (popup_state == POPUP_IN && sim_t - popup_t0 >= ANIM_POPUP_IN_S) {
            popup_state = POPUP_SHOWN;
            popup_shown_at = sim_t;
        }
        /* Авто-приховування — незалежне від g_popup_toggle: без нього
         * бонус-попап (нема кому послати другий toggle) назавжди лишався
         * б SHOWN, і POPUP_HIDDEN-гвардія вище блокувала б усі наступні
         * бонуси. Демо-цикл/SIGUSR1 і далі можуть сховати ЩЕ раніше через
         * g_popup_toggle — обидва шляхи просто ведуть у POPUP_OUT. */
        if (popup_state == POPUP_SHOWN && sim_t - popup_shown_at >= popup_hold) {
            popup_state = POPUP_OUT; popup_t0 = sim_t;
        }
        if (popup_state == POPUP_OUT && sim_t - popup_t0 >= ANIM_POPUP_OUT_S) popup_state = POPUP_HIDDEN;

        /* Поки першого меню немає (мережа ще не піднялась), кадр прозорий
         * і порожній: під шаром кіоска видно запасну картинку fbi з
         * останніми цінами (docs/raspberry-pi.md §6), а на overlap-підміні —
         * стару копію кіоска. Непрозорий порожній кадр закрив би і те, і те. */
        /* Зсув проти вигоряння: чотири позиції по колу, крок раз на
         * BURNIN_SHIFT_PERIOD_S. Малюємо на два пікселі вбік — цього не
         * видно оком, але статична картинка перестає бути статичною для
         * панелі (config.h). */
        {
            int phase = (int)(sim_t / BURNIN_SHIFT_PERIOD_S) & 3;
            comp.shift_x = (phase == 1 || phase == 2) ? BURNIN_SHIFT_PX : 0.0;
            comp.shift_y = (phase >= 2) ? BURNIN_SHIFT_PX : 0.0;
        }

        bool have_menu = menu_tex.id != 0;
        gl_clear(!have_menu);
        if (have_menu) gl_draw_quad(&comp, &menu_tex, 0, 0, STAGE_W, STAGE_H, 1.0);
        if (have_menu && prices_tex.id) gl_draw_quad(&comp, &prices_tex, PRICES_X, PRICES_Y, PRICES_W, PRICES_H, 1.0);
        if (have_menu && ad_tex.id) gl_draw_quad(&comp, &ad_tex, PANEL_X, AD_Y, PANEL_W, AD_H, 1.0);

        if (have_menu) bonus_draw(&bonus, &comp);

        if (have_menu && discount_shown > 0 && discount_tex.id)
            gl_draw_quad(&comp, &discount_tex, UPDATE_BANNER_X, UPDATE_BANNER_Y,
                         discount_tex_w, UPDATE_BANNER_H, 1.0);
        else if (upd.active && update_tex.id)
            gl_draw_quad(&comp, &update_tex, UPDATE_BANNER_X, UPDATE_BANNER_Y,
                         update_tex_w, UPDATE_BANNER_H, 1.0);
        else if (offline_shown && offline_tex.id)
            gl_draw_quad(&comp, &offline_tex, UPDATE_BANNER_X, UPDATE_BANNER_Y,
                         offline_tex_w, UPDATE_BANNER_H, 1.0);

        if (have_menu && popup_state != POPUP_HIDDEN && popup_tex.id) {
            double px = (STAGE_W - POPUP_W) / 2.0, py = (STAGE_H - POPUP_H) / 2.0;
            double alpha = 1.0, scale = 1.0, dy = 0.0;
            if (popup_state == POPUP_IN) {
                double x = (sim_t - popup_t0) / ANIM_POPUP_IN_S;
                double e = ease_out(x < 0 ? 0 : (x > 1 ? 1 : x));
                alpha = e; scale = 0.94 + 0.06 * e; dy = 24.0 * (1.0 - e);
            } else if (popup_state == POPUP_OUT) {
                double x = (sim_t - popup_t0) / ANIM_POPUP_OUT_S;
                double e = ease_in(x < 0 ? 0 : (x > 1 ? 1 : x));
                alpha = 1.0 - e; scale = 1.0 - 0.04 * e; dy = 18.0 * e;
            }
            /* Затемнення проявляється й гасне разом із попапом, але не
             * масштабується: воно на всю сцену. */
            if (dim_tex.id) gl_draw_quad(&comp, &dim_tex, 0, 0, STAGE_W, STAGE_H, POPUP_DIM_A * alpha);
            double w = POPUP_W * scale, h = POPUP_H * scale;
            gl_draw_quad(&comp, &popup_tex,
                         px + (POPUP_W - w) / 2.0, py + dy + (POPUP_H - h) / 2.0,
                         w, h, alpha);
        }

        platform_swap(plat);
        telemetry_frame(&tel);
        telemetry_poll(&tel);
        frame_no++;

        if (g_dump_requested) {
            g_dump_requested = 0;
            const char *dump_path = getenv("DUMP_PNG");
            if (!dump_path) dump_path = "/tmp/kiosk-frame.png";
            bool ok = platform_dump_png(plat, dump_path);
            fprintf(stderr, "main: SIGUSR2 -> знімок %s: %s\n", dump_path, ok ? "ok" : "провалився");
        }

        if (desktop_frames > 0 && frame_no == desktop_frames / 2 && !getenv("NO_DEMO_POPUP")) {
            /* середина прогону — демо попапу без керування ззовні */
            g_popup_toggle = 1;
        }
        if (desktop_frames > 0 && frame_no >= desktop_frames) break;
    }

    if (desktop_frames > 0) {
        platform_dump_png(plat, "/tmp/kiosk-frame.png");
        fprintf(stderr, "main: кадр збережено в /tmp/kiosk-frame.png (%ld кадрів, %.1f fps сер.)\n",
                frame_no, frame_no / (now_s() - t_start));
    }

    /* stop під мʼютексом не обовʼязковий (sig_atomic_t), але pthread_join
     * тут може чекати до CURLOPT_TIMEOUT (15с, menu.c) — потік перевіряє
     * stop лише між сплячками по 100мс, не посеред curl_easy_perform(). */
    if (ws) ws_stop(ws);
    poller.stop = 1;
    pthread_join(poll_thread, NULL);
    pthread_mutex_destroy(&poller.mu);

    telemetry_close(&tel);
    gl_texture_destroy(&menu_tex);
    gl_texture_destroy(&ad_tex);
    gl_texture_destroy(&prices_tex);
    if (poller.pending_menu) cairo_surface_destroy(poller.pending_menu);
    if (poller.pending_ad) cairo_surface_destroy(poller.pending_ad);
    if (poller.pending_prices) cairo_surface_destroy(poller.pending_prices);
    if (poller.base_menu) cairo_surface_destroy(poller.base_menu);
    if (poller.base_ad) cairo_surface_destroy(poller.base_ad);
    gl_texture_destroy(&popup_tex);
    gl_texture_destroy(&dim_tex);
    popup_art_destroy(&popup_art);
    gl_texture_destroy(&update_tex);
    gl_texture_destroy(&offline_tex);
    gl_texture_destroy(&discount_tex);
    bonus_destroy(&bonus);
    platform_destroy(plat);
    menu_poll_close();   /* до curl_global_cleanup(): хендл ще живий */
    curl_global_cleanup();
    return 0;
}
