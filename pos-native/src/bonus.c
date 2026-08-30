#include "bonus.h"
#include "render.h"
#include "svgtpl.h"
#include "qr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>

static cairo_surface_t *g_coin_png = NULL;

/* Лишається для render_bonus_popup() — єдиний споживач coin.png через
 * прямий Cairo, що лишився. bonus_row.svg/bonus_empty.svg тепер тягнуть
 * coin.png сам через <image>, без участі цього коду. */
static void ensure_coin_loaded(const char *assets_dir) {
    if (g_coin_png) return;
    char path[1024];
    snprintf(path, sizeof(path), "%s/coin.png", assets_dir);
    g_coin_png = cairo_image_surface_create_from_png(path);
    if (cairo_surface_status(g_coin_png) != CAIRO_STATUS_SUCCESS) {
        fprintf(stderr, "bonus: не завантажив %s\n", path);
        cairo_surface_destroy(g_coin_png);
        g_coin_png = NULL;
    }
}

static void draw_png_scaled(cairo_t *cr, cairo_surface_t *png, double x, double y, double w, double h) {
    if (!png) return;
    int pw = cairo_image_surface_get_width(png), ph = cairo_image_surface_get_height(png);
    if (pw <= 0 || ph <= 0) return;
    cairo_save(cr);
    cairo_translate(cr, x, y);
    cairo_scale(cr, w / pw, h / ph);
    cairo_set_source_surface(cr, png, 0, 0);
    cairo_paint(cr);
    cairo_restore(cr);
}

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
    draw_text(cr, 0, 0, font, TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, txt);
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

    const char *keys[] = { "ASSETS", "IMG", "NAME", "EARNED_AT", "COIN_PILL_W", "COINS" };
    const char *vals[] = { assets_dir, img, name, row->earned_at, pill_w_s, coin_text };
    char *full = svgtpl_sub(tpl, keys, vals, 6);
    free(tpl);
    free(name);
    if (!full) return NULL;

    cairo_surface_t *surf = svgtpl_render(full, (int)BONUS_ROW_W, (int)BONUS_ROW_H, assets_dir);
    free(full);
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
    gl_texture_destroy(&row->qr_tex);
    gl_texture_destroy(&row->bar_tex);
    gl_texture_destroy(&row->timer_tex);
    memset(row, 0, sizeof(*row));
}

/* -------- публічне API -------- */

void bonus_init(bonus_state_t *b, double now, const char *assets_dir) {
    memset(b, 0, sizeof(*b));
    b->next_emulated_at = now + BONUS_EMULATE_PERIOD_S;
    srand((unsigned)time(NULL));
    ensure_coin_loaded(assets_dir);
    b->panel_surf = render_panel_frame(false, assets_dir);
    if (b->panel_surf) b->panel_tex = gl_texture_from_cairo(b->panel_surf);
    b->panel_has_rows = false;
}

bool bonus_tick_emulate(bonus_state_t *b, double now, const menu_t *menu,
                         char out_drink_name[64], int *out_coins) {
    if (now < b->next_emulated_at) return false;
    b->next_emulated_at = now + BONUS_EMULATE_PERIOD_S;

    if (b->count >= BONUS_MAX_VISIBLE) {
        fprintf(stderr, "bonus: емуляція пропущена — панель повна (%d/%d)\n", b->count, BONUS_MAX_VISIBLE);
        return false;
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

    if (menu->drink_count > 0) {
        int idx = rand() % menu->drink_count;
        const drink_t *d = &menu->drinks[idx];
        snprintf(row->drink_name, sizeof(row->drink_name), "%s", d->name);
        snprintf(row->sprite, sizeof(row->sprite), "%s", d->sprite);
    } else {
        snprintf(row->drink_name, sizeof(row->drink_name), "Кавенятко");
    }
    row->coins = 1 + rand() % 5;
    row->created_at = now;

    time_t t = time(NULL);
    struct tm lt;
    localtime_r(&t, &lt);
    snprintf(row->earned_at, sizeof(row->earned_at), "%02d:%02d", lt.tm_hour, lt.tm_min);

    /* Плейсхолдер-payload, поки нема реального протоколу/бекенда —
     * див. bonus.h: контракт назовні (bonus_update/bonus_draw) не
     * зміниться, коли зʼявиться справжній claim-URL з WS. */
    snprintf(row->qr_payload, sizeof(row->qr_payload), "https://extrovert.cafe/b/%08x", (unsigned)rand());

    b->count++;
    snprintf(out_drink_name, 64, "%s", row->drink_name);
    *out_coins = row->coins;
    return true;
}

void bonus_update(bonus_state_t *b, double now, const char *assets_dir) {
    int w = 0;
    for (int i = 0; i < b->count; i++) {
        double remain = BONUS_TTL_S - (now - b->rows[i].created_at);
        if (remain <= 0) { bonus_row_free(&b->rows[i]); continue; }
        if (w != i) b->rows[w] = b->rows[i];
        w++;
    }
    b->count = w;

    bool has_rows = b->count > 0;
    if (has_rows != b->panel_has_rows || !b->panel_tex.id) {
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
        if (!row->chrome_tex.id) {
            cairo_surface_t *cs = render_row_chrome(row, assets_dir);
            if (cs) { row->chrome_tex = gl_texture_from_cairo(cs); cairo_surface_destroy(cs); }
        }
        if (!row->qr_tex.id) {
            cairo_surface_t *qs = render_qr(row->qr_payload, (int)QR_ROW_SIZE);
            if (qs) { row->qr_tex = gl_texture_from_cairo(qs); cairo_surface_destroy(qs); }
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
        if (row->qr_tex.id) {
            /* центр кільця з bonus_row.svg (356,70), розмір фіксований QR_ROW_SIZE */
            double qs = QR_ROW_SIZE;
            gl_draw_quad(comp, &row->qr_tex, rx + 356.0 - qs / 2.0, ry + 70.0 - qs / 2.0, qs, qs, 1.0);
        }
    }
}

void bonus_destroy(bonus_state_t *b) {
    for (int i = 0; i < b->count; i++) bonus_row_free(&b->rows[i]);
    b->count = 0;
    if (b->panel_surf) cairo_surface_destroy(b->panel_surf);
    gl_texture_destroy(&b->panel_tex);
    if (g_coin_png) { cairo_surface_destroy(g_coin_png); g_coin_png = NULL; }
}

cairo_surface_t *render_bonus_popup(const char *drink_name, int coins, const char *assets_dir) {
    ensure_coin_loaded(assets_dir);

    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, (int)POPUP_W, (int)POPUP_H);
    cairo_t *cr = cairo_create(s);

    rounded_rect(cr, 0, 0, POPUP_W, POPUP_H, POPUP_R);
    cairo_set_source_rgba(cr, 0x12 / 255.0, 0x10 / 255.0, 0x0F / 255.0, POPUP_BG_A);
    cairo_fill_preserve(cr);
    cairo_set_source_rgba(cr, 1, 1, 1, 0.18);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    double icon_size = BONUS_POPUP_COIN_SIZE;
    double icon_x = 48.0, icon_y = POPUP_H / 2.0 - icon_size / 2.0;
    draw_png_scaled(cr, g_coin_png, icon_x, icon_y, icon_size, icon_size);

    double text_x = icon_x + icon_size + 32.0;
    char title[96];
    snprintf(title, sizeof(title), "+%d монет — %s", coins, drink_name);
    draw_text_vc(cr, text_x, POPUP_H / 2.0 - 24.0, FONT_600 " 32px", TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, title);
    draw_text_vc(cr, text_x, POPUP_H / 2.0 + 22.0, FONT_400 " 20px", TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B,
                 "Забери QR у панелі бонусів праворуч");

    cairo_destroy(cr);
    return s;
}
