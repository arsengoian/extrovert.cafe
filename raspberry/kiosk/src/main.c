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

static volatile sig_atomic_t g_running = 1;
static volatile sig_atomic_t g_popup_toggle = 0;
static volatile sig_atomic_t g_dump_requested = 0;

static void on_sigterm(int sig) { (void)sig; g_running = 0; }
static void on_sigusr1(int sig) { (void)sig; g_popup_toggle = 1; }  /* показати/сховати демо-попап */
static void on_sigusr2(int sig) { (void)sig; g_dump_requested = 1; }  /* знімок живого кадру на вимогу */

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
static void write_fallback_png(cairo_surface_t *menu_s, cairo_surface_t *ad_s) {
    const char *path = getenv("FALLBACK_PNG");
    if (!path || !path[0] || !menu_s) return;
    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, STAGE_W, STAGE_H);
    cairo_t *cr = cairo_create(s);
    cairo_set_source_surface(cr, menu_s, 0, 0);
    cairo_paint(cr);
    if (ad_s) { cairo_set_source_surface(cr, ad_s, PANEL_X, AD_Y); cairo_paint(cr); }
    cairo_destroy(cr);
    /* pid у назві: при overlap-підміні дві копії кіоска стартують разом і
     * обидві пишуть картинку — спільний .tmp вони б зіпсували одна одній. */
    char tmp[1024];
    snprintf(tmp, sizeof(tmp), "%s.%d.tmp", path, (int)getpid());
    if (cairo_surface_write_to_png(s, tmp) == CAIRO_STATUS_SUCCESS && rename(tmp, path) == 0)
        fprintf(stderr, "main: запасна картинка → %s\n", path);
    else
        fprintf(stderr, "main: запасна картинка не записалась (%s)\n", path);
    cairo_surface_destroy(s);
}

/* Перерендер меню й реклами в текстури — і на старті, і після оновлення. */
static void apply_menu(const menu_t *menu, const char *assets_dir,
                       gl_texture_t *menu_tex, gl_texture_t *ad_tex) {
    cairo_surface_t *m = render_menu(menu, assets_dir);
    cairo_surface_t *a = render_ad(menu, assets_dir);
    if (m) {
        if (getenv("DEBUG_CAIRO_PNG")) cairo_surface_write_to_png(m, getenv("DEBUG_CAIRO_PNG"));
        gl_texture_destroy(menu_tex);
        *menu_tex = gl_texture_from_cairo(m);
    }
    gl_texture_destroy(ad_tex);
    if (a) *ad_tex = gl_texture_from_cairo(a);
    write_fallback_png(m, a);
    if (m) cairo_surface_destroy(m);
    if (a) cairo_surface_destroy(a);
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
    menu_t pending;      /* нова менюшка, чекає, поки головний потік забере
                           * її й перерендерить (тільки тут чіпаємо GL/Cairo) */
    bool has_pending;
    const char *url;
    volatile sig_atomic_t stop;
} menu_poller_t;

static void *menu_poll_thread(void *arg) {
    menu_poller_t *mp = (menu_poller_t *)arg;
    for (;;) {
        pthread_mutex_lock(&mp->mu);
        menu_t attempt = mp->last;
        pthread_mutex_unlock(&mp->mu);

        /* Чекаємо refreshSec, перевіряючи stop кожні 100мс, а не суцільним
         * sleep(refresh_s) — інакше зупинка (SIGTERM) чекала б до хвилини. */
        /* Поки жодного меню ще не було — часто: після знеструмлення кіоск
         * стартує раніше, ніж піднімається мережа (21.09.2026 перший запит
         * падав щоразу), і чекати звичайну хвилину до другої спроби —
         * хвилина порожнього кадру замість меню. */
        int refresh_s = !attempt.valid ? MENU_RETRY_S
                      : attempt.refresh_sec > 0 ? attempt.refresh_sec : 60;
        for (int waited = 0; waited < refresh_s * 10 && !mp->stop; waited++)
            usleep(100000);
        if (mp->stop) break;

        if (menu_poll(mp->url, &attempt)) {
            pthread_mutex_lock(&mp->mu);
            mp->last = attempt;
            mp->pending = attempt;
            mp->has_pending = true;
            pthread_mutex_unlock(&mp->mu);
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
        apply_menu(&menu, assets_dir, &menu_tex, &ad_tex);
    } else {
        fprintf(stderr, "main: не вдалось завантажити меню з %s, стартую з порожнім екраном\n", url);
    }

    /* Далі опитування йде фоновим потоком (menu_poll_thread вище) — цей
     * перший виклик лишається синхронним навмисно, той самий сенс, що й
     * у коментарі над ним: перший кадр має вже мати вміст. */
    menu_poller_t poller = {0};
    pthread_mutex_init(&poller.mu, NULL);
    poller.last = menu;
    poller.url = url;
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
        if (poller.has_pending) {
            new_menu = poller.pending;
            poller.has_pending = false;
            got_new_menu = true;
        }
        pthread_mutex_unlock(&poller.mu);
        if (got_new_menu) {
            menu = new_menu;
            apply_menu(&menu, assets_dir, &menu_tex, &ad_tex);
            fprintf(stderr, "main: меню оновлено, %d напоїв\n", menu.drink_count);
        }

        /* Оновлення: апдейтер створює файл-прапорець перед підміною версії,
         * кіоск показує плашку в шапці й працює далі до самого SIGTERM. */
        update_poll(&upd, update_flag, sim_t);
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
        bool have_menu = menu_tex.id != 0;
        gl_clear(!have_menu);
        if (have_menu) gl_draw_quad(&comp, &menu_tex, 0, 0, STAGE_W, STAGE_H, 1.0);
        if (have_menu && ad_tex.id) gl_draw_quad(&comp, &ad_tex, PANEL_X, AD_Y, PANEL_W, AD_H, 1.0);

        if (have_menu) bonus_draw(&bonus, &comp);

        if (upd.active && update_tex.id)
            gl_draw_quad(&comp, &update_tex, UPDATE_BANNER_X, UPDATE_BANNER_Y,
                         update_tex_w, UPDATE_BANNER_H, 1.0);

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

        if (desktop_frames > 0 && frame_no == desktop_frames / 2) {
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
    gl_texture_destroy(&popup_tex);
    gl_texture_destroy(&dim_tex);
    popup_art_destroy(&popup_art);
    gl_texture_destroy(&update_tex);
    bonus_destroy(&bonus);
    platform_destroy(plat);
    curl_global_cleanup();
    return 0;
}
