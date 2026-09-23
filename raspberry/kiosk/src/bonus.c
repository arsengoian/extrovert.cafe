#include "bonus.h"
#include "render.h"
#include "svgtpl.h"
#include "qr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>

/* -------- смуга прогресу: єдине, що перемальовується щокадру --------
 * Локальні координати (0,0)-(BONUS_BAR_W,BONUS_BAR_H) — зсув у рядку
 * (BONUS_BAR_X/Y) застосовується тільки при композитингу (bonus_draw),
 * як і для чашок/попапу в main.c. */

static void draw_bar_local(cairo_t *cr, double frac) {
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    if (frac <= 0) return;
    double w = BONUS_BAR_W * frac;
    if (w < BONUS_BAR_H) w = BONUS_BAR_H;   /* rounded_rect вимагає w >= 2*r */

    rounded_rect(cr, 0, 0, w, BONUS_BAR_H, BONUS_BAR_R);
    /* лінійний градієнт на всю ширину ТРЕКА (не заповнення) — той самий
     * ефект, що url(#pill) у макеті: колір зсувається разом із заповненням,
     * не розтягується наново під кожну ширину */
    cairo_pattern_t *grad = cairo_pattern_create_linear(0, 0, BONUS_BAR_W, 0);
    cairo_pattern_add_color_stop_rgb(grad, 0.0, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
    cairo_pattern_add_color_stop_rgb(grad, 1.0, ACCENT2_R, ACCENT2_G, ACCENT2_B);
    cairo_set_source(cr, grad);
    cairo_fill(cr);
    cairo_pattern_destroy(grad);
}

/* Переюзана поверхня — тільки clear+перемалювати, без нової алокації
 * буфера щокадру; текстура оновлюється glTexSubImage2D (gl.c). */
static void redraw_bar(bonus_row_t *row, double frac) {
    if (!row->bar_surf) {
        row->bar_surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32,
                                                     (int)BONUS_BAR_W, (int)BONUS_BAR_H);
    }
    cairo_t *cr = cairo_create(row->bar_surf);
    cairo_set_operator(cr, CAIRO_OPERATOR_CLEAR);
    cairo_paint(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_OVER);
    draw_bar_local(cr, frac);
    cairo_destroy(cr);
    gl_texture_update_from_cairo(&row->bar_tex, row->bar_surf);
}

/* -------- текст таймера: перепікається раз на секунду --------
 * Рядок несе ЖИВЕ число ("1:42 до завершення") — на відміну від решти
 * рядка, тут нема "готового" шматка в SVG-шаблоні, який можна перепекти
 * один раз: контент сам змінюється щосекунди. Лишається прямим Cairo. */

static cairo_surface_t *render_row_timer(int sec) {
    if (sec < 0) sec = 0;
    char txt[40];
    snprintf(txt, sizeof(txt), "%d:%02d до завершення", sec / 60, sec % 60);
    char font[32];
    snprintf(font, sizeof(font), FONT_POPPINS " SemiBold %dpx", BONUS_COUNTDOWN_FONT_SIZE);
    int w, h;
    text_extents(font, txt, &w, &h);
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, w, h);
    cairo_t *cr = cairo_create(s);
    /* Останні пів хвилини — рожевим акцентом, як у макеті: клієнт має
     * встигнути помітити, що бонус от-от зникне. */
    if (sec < BONUS_URGENT_S)
        draw_text(cr, 0, 0, font, ACCENT2_R, ACCENT2_G, ACCENT2_B, txt);
    else
        draw_text(cr, 0, 0, font, TIMER_FG_R, TIMER_FG_G, TIMER_FG_B, txt);
    cairo_destroy(cr);
    return s;
}

/* -------- фон рядка: SVG-шаблон (assets/templates/bonus_row.svg) --------
 * Пече раз при появі бонусу — назва/час/монети/мініатюра не змінюються
 * все життя рядка, кільце й трек прогрес-бару в самому шаблоні статичні. */

static cairo_surface_t *render_row_chrome(const bonus_row_t *row, const char *assets_dir) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/bonus_row.svg", assets_dir);
    char *tpl = svgtpl_load(path);
    if (!tpl) return NULL;

    char name_font[32];
    snprintf(name_font, sizeof(name_font), FONT_700 " %dpx", BONUS_NAME_FONT_SIZE);
    char *name_esc = svgtpl_esc(row->drink_name);
    char *name = svgtpl_ellipsize(name_esc, name_font, BONUS_NAME_MAX_W);
    free(name_esc);

    char img[1024];
    snprintf(img, sizeof(img), "%s/drinks/%s.png", assets_dir, row->sprite[0] ? row->sprite : "none");

    /* пігулка монет — ШИРИНА рахується від виміряного тексту (кількість
     * монет може бути 1-3 цифри), позиція в шаблоні фіксована */
    char coin_text[8];
    snprintf(coin_text, sizeof(coin_text), "%d", row->coins);
    char coin_font[32];
    snprintf(coin_font, sizeof(coin_font), FONT_POPPINS " Bold %dpx", BONUS_COIN_FONT_SIZE);
    int ctw;
    text_extents(coin_font, coin_text, &ctw, NULL);
    double pill_w = BONUS_COIN_PILL_PAD_L + BONUS_COIN_ICON_SIZE + BONUS_COIN_ICON_TEXT_GAP + ctw + BONUS_COIN_PILL_PAD_R;
    char pill_w_s[16];
    snprintf(pill_w_s, sizeof(pill_w_s), "%.1f", pill_w);

    /* Бейдж-подарунок стоїть одразу за пігулкою, тому його x залежить від
     * тієї самої виміряної ширини (8,5 — відступ із макета). */
    char *badge = NULL;
    if (row->secret) {
        char bpath[1024];
        snprintf(bpath, sizeof(bpath), "%s/templates/bonus_secret.svg", assets_dir);
        char *btpl = svgtpl_load(bpath);
        if (btpl) {
            char bx[16];
            snprintf(bx, sizeof(bx), "%.1f", BONUS_COIN_PILL_X + pill_w + BONUS_SECRET_GAP);
            const char *bkeys[] = { "X" };
            const char *bvals[] = { bx };
            badge = svgtpl_sub(btpl, bkeys, bvals, 1);
            free(btpl);
        }
    }

    const char *keys[] = { "ASSETS", "IMG", "NAME", "EARNED_AT", "COIN_PILL_W", "COINS", "SECRET_BADGE" };
    const char *vals[] = { assets_dir, img, name, row->earned_at, pill_w_s, coin_text,
                           badge ? badge : "" };
    char *full = svgtpl_sub(tpl, keys, vals, 7);
    free(tpl);
    free(name);
    free(badge);
    if (!full) return NULL;

    cairo_surface_t *surf = svgtpl_render(full, (int)BONUS_ROW_W, (int)BONUS_ROW_H, assets_dir);
    free(full);
    /* QR — поверх SVG-шару прямим Cairo, в ту саму поверхню: одна текстура
     * на рядок, а не рядок і окремий квад під код (чому не SVG — qr.h). */
    if (surf) {
        cairo_t *cr = cairo_create(surf);
        qr_paint(cr, row->qr_payload, QR_ROW_X, QR_ROW_Y, QR_ROW_SIZE);
        cairo_destroy(cr);
    }
    return surf;
}

/* -------- рамка панелі: SVG-шаблон, порожній/заповнений стан --------
 * Своя частота перемальовування (при зміні порожньо/не-порожньо), не
 * привʼязана до опитування меню. */

static cairo_surface_t *render_panel_frame(bool has_rows, const char *assets_dir) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/%s", assets_dir,
             has_rows ? "bonus_header.svg" : "bonus_empty.svg");
    char *tpl = svgtpl_load(path);
    if (!tpl) return NULL;

    char *full;
    if (has_rows) {
        full = strdup(tpl);   /* без плейсхолдерів — заголовок повністю статичний */
    } else {
        const char *keys[] = { "ASSETS" };
        const char *vals[] = { assets_dir };
        full = svgtpl_sub(tpl, keys, vals, 1);
    }
    free(tpl);
    if (!full) return NULL;

    cairo_surface_t *surf = svgtpl_render(full, (int)PANEL_W, (int)BONUS_PANEL_H, assets_dir);
    free(full);
    return surf;
}

/* -------- рядок: memory management -------- */

static void bonus_row_free(bonus_row_t *row) {
    if (row->bar_surf) cairo_surface_destroy(row->bar_surf);
    if (row->timer_surf) cairo_surface_destroy(row->timer_surf);
    gl_texture_destroy(&row->chrome_tex);
    gl_texture_destroy(&row->bar_tex);
    gl_texture_destroy(&row->timer_tex);
    memset(row, 0, sizeof(*row));
}

/* -------- публічне API -------- */

void bonus_init(bonus_state_t *b, double now, const char *assets_dir) {
    memset(b, 0, sizeof(*b));
    b->next_emulated_at = now + BONUS_EMULATE_PERIOD_S;
    srand((unsigned)time(NULL));
    b->panel_surf = render_panel_frame(false, assets_dir);
    if (b->panel_surf) b->panel_tex = gl_texture_from_cairo(b->panel_surf);
    b->panel_has_rows = false;
}

/* Новий рядок у панелі. NULL означає «панель повна» — так поводиться і
 * справжній WS: подія прийшла, місця немає, показати нема де. */
static bonus_row_t *take_row(bonus_state_t *b, double now, const char *who) {
    if (b->count >= BONUS_MAX_VISIBLE) {
        fprintf(stderr, "bonus: %s пропущено — панель повна (%d/%d)\n", who, b->count, BONUS_MAX_VISIBLE);
        return NULL;
    }

    /* Слот b->rows[b->count] тут завжди або нуль-ований (bonus_init), або
     * "хвіст" після компактації в bonus_update: struct-присвоєння там
     * (b->rows[w] = b->rows[i]) переносить володіння текстурами/поверхнями
     * в молодший індекс, а старший лишається псевдонімом, який ЗАВЖДИ
     * memset, ніколи не free — інакше подвійне звільнення того самого
     * cairo_surface_t* чи GL id, яким тепер володіє молодший індекс. */
    bonus_row_t *row = &b->rows[b->count];
    memset(row, 0, sizeof(*row));
    row->last_baked_sec = -1;
    row->created_at = now;

    time_t t = time(NULL);
    struct tm lt;
    localtime_r(&t, &lt);
    snprintf(row->earned_at, sizeof(row->earned_at), "%02d:%02d", lt.tm_hour, lt.tm_min);
    return row;
}

static void fill_popup(const bonus_row_t *row, bonus_popup_t *out) {
    out->coins = row->coins;
    out->secret = row->secret;
    snprintf(out->qr_payload, sizeof(out->qr_payload), "%s", row->qr_payload);
}

/* Ідентифікатор точки з docs/urls.md: ^[a-z0-9][a-z0-9-]{1,30}$. Перевіряємо,
 * бо рядок іде в URL як є — без екранування. */
static bool point_id_ok(const char *p) {
    size_t n = strlen(p);
    if (n < 2 || n > 31) return false;
    for (size_t i = 0; i < n; i++) {
        char c = p[i];
        bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c == '-' && i > 0);
        if (!ok) return false;
    }
    return true;
}

/* Посилання, яке несе QR бонусу. /b/<токен> — той самий шлях, що розбирає
 * застосунок (frontend/client/src/main.jsx): екран бонусу поверх гри.
 * ?p=<точка> — звідки людина прийшла, той самий параметр, що на QR-наклейці
 * автомата (docs/urls.md): за задумом сайт кладе його в localStorage і після
 * входу записує в users.metadata.qr_pos (21.09.2026 на сайті ще не зроблено —
 * поки параметр просто ігнорується). За токеном бекенд і так знає точку, але
 * лише поки грант живий — p лишається, навіть коли бонус уже прострочений
 * чи забраний, і привʼязує нового гравця до точки, де він прийшов.
 * Тут саме публічний ідентифікатор (POINT, kyiv-01), а не config/point.key:
 * ключ підписує запити точки, і в QR, який фотографує будь-хто, йому не місце. */
static void bonus_link(char *out, size_t n, const char *token) {
    const char *point = getenv("POINT");
    if (point && point_id_ok(point))
        snprintf(out, n, "https://extrovert.cafe/b/%s?p=%s", token, point);
    else
        snprintf(out, n, "https://extrovert.cafe/b/%s", token);
}

/* Подія bonus_ready із ws (ws.c). Назву й картинку беремо зі свого ж меню за
 * system_code — тоді в рядку те саме, що на картці поруч; назва з події
 * потрібна лише коли напою в меню немає (його щойно прибрали, а чек уже
 * пробито). */
bool bonus_add_event(bonus_state_t *b, double now, const menu_t *menu,
                     const char *code, const char *name, int coins,
                     const char *claim_token, int items, bonus_popup_t *out) {
    bonus_row_t *row = take_row(b, now, "подію");
    if (!row) return false;

    const drink_t *found = NULL;
    if (code && code[0]) {
        for (int i = 0; i < menu->drink_count; i++) {
            if (strcmp(menu->drinks[i].system_code, code) == 0) { found = &menu->drinks[i]; break; }
        }
    }
    if (found) {
        snprintf(row->drink_name, sizeof(row->drink_name), "%s", found->name);
        snprintf(row->sprite, sizeof(row->sprite), "%s", found->sprite);
    } else {
        snprintf(row->drink_name, sizeof(row->drink_name), "%s", (name && name[0]) ? name : "Кавенятко");
    }
    row->coins = coins;
    /* Предмет: якщо подія каже прямо — віримо їй. Поки checkbox цього не
     * шле (ws.h: items = -1), вгадуємо з меню: напій «з бонусами» за
     * економікою дає лутдроп завжди (gamification_economy.md). Звичайні
     * напої мають лише 15 % шанс, і його без поля в події не вгадати —
     * тоді плитки просто не буде. */
    if (items >= 0) row->secret = items > 0;
    else            row->secret = found && found->is_bonus;

    bonus_link(row->qr_payload, sizeof(row->qr_payload),
               (claim_token && claim_token[0]) ? claim_token : "");
    snprintf(row->claim_token, sizeof(row->claim_token), "%s", claim_token ? claim_token : "");

    b->count++;
    fill_popup(row, out);
    fprintf(stderr, "bonus: подія — %s, %d монет%s\n", row->drink_name, row->coins,
            row->secret ? " + предмет" : "");
    return true;
}

bool bonus_tick_emulate(bonus_state_t *b, double now, const menu_t *menu, bonus_popup_t *out) {
    if (now < b->next_emulated_at) return false;
    b->next_emulated_at = now + BONUS_EMULATE_PERIOD_S;

    bonus_row_t *row = take_row(b, now, "емуляцію");
    if (!row) return false;

    const drink_t *d = NULL;
    if (menu->drink_count > 0) {
        d = &menu->drinks[rand() % menu->drink_count];
        snprintf(row->drink_name, sizeof(row->drink_name), "%s", d->name);
        snprintf(row->sprite, sizeof(row->sprite), "%s", d->sprite);
    } else {
        snprintf(row->drink_name, sizeof(row->drink_name), "Кавенятко");
    }
    /* Правдоподібні числа, а не 1..5: бонусний напій дає свої монети й
     * предмет завжди, звичайний — 10..25 монет (≈21 у середньому за
     * економікою) і предмет зрідка, щоб на екрані траплялись обидва
     * варіанти попапу. */
    if (d && d->is_bonus) {
        row->coins = d->coins;
        row->secret = true;
    } else {
        row->coins = 10 + rand() % 16;
        row->secret = rand() % 4 == 0;
    }

    /* Емуляція живе далі лише як запасний варіант без токена (main.c), тож
     * токен тут вигаданий — але посилання того самого вигляду, що й
     * справжнє, щоб на екрані був QR тієї самої щільності. */
    char fake[16];
    snprintf(fake, sizeof(fake), "%08x", (unsigned)rand());
    bonus_link(row->qr_payload, sizeof(row->qr_payload), fake);

    b->count++;
    fill_popup(row, out);
    return true;
}

void bonus_demo_popup(bonus_popup_t *out) {
    /* Рівно варіант із макета: +100 і секретний предмет. */
    out->coins = 100;
    out->secret = true;
    bonus_link(out->qr_payload, sizeof(out->qr_payload), "demo");
}

/* Забраний бонус не прибираємо тут своїми руками: відсуваємо час появи за
 * межу життя рядка, і його прибере та сама компактація в bonus_update, що
 * й прострочені. Один шлях звільнення текстур — один шанс помилитись. */
bool bonus_mark_taken(bonus_state_t *b, const char *claim_token) {
    if (!claim_token || !claim_token[0]) return false;
    for (int i = 0; i < b->count; i++) {
        if (strcmp(b->rows[i].claim_token, claim_token) != 0) continue;
        b->rows[i].created_at -= BONUS_TTL_S + 1.0;
        fprintf(stderr, "bonus: забрали з телефона — прибираємо рядок\n");
        return true;
    }
    return false;
}

void bonus_update(bonus_state_t *b, double now, const char *assets_dir, bool bake_ok) {
    int w = 0;
    for (int i = 0; i < b->count; i++) {
        double remain = BONUS_TTL_S - (now - b->rows[i].created_at);
        if (remain <= 0) { bonus_row_free(&b->rows[i]); continue; }
        if (w != i) b->rows[w] = b->rows[i];
        w++;
    }
    b->count = w;

    bool has_rows = b->count > 0;
    if (bake_ok && (has_rows != b->panel_has_rows || !b->panel_tex.id)) {
        if (b->panel_surf) cairo_surface_destroy(b->panel_surf);
        b->panel_surf = render_panel_frame(has_rows, assets_dir);
        gl_texture_destroy(&b->panel_tex);
        if (b->panel_surf) b->panel_tex = gl_texture_from_cairo(b->panel_surf);
        b->panel_has_rows = has_rows;
    }

    for (int i = 0; i < b->count; i++) {
        bonus_row_t *row = &b->rows[i];
        double remain = BONUS_TTL_S - (now - row->created_at);
        if (remain < 0) remain = 0;
        double frac = remain / BONUS_TTL_S;

        /* CPU-копія SVG-рендеру потрібна лише до першого завантаження в
         * GPU-текстуру — на відміну від bar_surf (переюзається щокадру) й
         * timer_surf (живе до наступного перепікання), тут вона взагалі
         * більше не потрібна після gl_texture_from_cairo(). */
        if (!row->chrome_tex.id && bake_ok) {
            cairo_surface_t *cs = render_row_chrome(row, assets_dir);
            if (cs) { row->chrome_tex = gl_texture_from_cairo(cs); cairo_surface_destroy(cs); }
        }

        int sec = (int)ceil(remain);
        if (sec != row->last_baked_sec) {
            if (row->timer_surf) cairo_surface_destroy(row->timer_surf);
            row->timer_surf = render_row_timer(sec);
            gl_texture_destroy(&row->timer_tex);
            row->timer_tex = gl_texture_from_cairo(row->timer_surf);
            row->last_baked_sec = sec;
        }

        redraw_bar(row, frac);
    }
}

void bonus_draw(bonus_state_t *b, gl_compositor_t *comp) {
    if (b->panel_tex.id) gl_draw_quad(comp, &b->panel_tex, PANEL_X, BONUS_Y, PANEL_W, BONUS_PANEL_H, 1.0);

    for (int i = 0; i < b->count; i++) {
        bonus_row_t *row = &b->rows[i];
        if (!row->chrome_tex.id) continue;   /* ще не спечений (bonus_update, bake_ok) */
        double rx = PANEL_X + BONUS_ROW_X;
        double ry = BONUS_Y + BONUS_ROW_Y0 + i * (BONUS_ROW_H + BONUS_ROW_GAP);

        if (row->chrome_tex.id) gl_draw_quad(comp, &row->chrome_tex, rx, ry, BONUS_ROW_W, BONUS_ROW_H, 1.0);
        if (row->bar_tex.id)
            gl_draw_quad(comp, &row->bar_tex, rx + BONUS_BAR_X, ry + BONUS_BAR_Y, BONUS_BAR_W, BONUS_BAR_H, 1.0);
        if (row->timer_tex.id) {
            gl_draw_quad(comp, &row->timer_tex, rx + BONUS_COUNTDOWN_X,
                         ry + BONUS_COUNTDOWN_Y - row->timer_tex.h / 2.0,
                         (double)row->timer_tex.w, (double)row->timer_tex.h, 1.0);
        }
    }
}

void bonus_destroy(bonus_state_t *b) {
    for (int i = 0; i < b->count; i++) bonus_row_free(&b->rows[i]);
    b->count = 0;
    if (b->panel_surf) cairo_surface_destroy(b->panel_surf);
    gl_texture_destroy(&b->panel_tex);
}
