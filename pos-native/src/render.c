#include "render.h"
#include "config.h"
#include <pango/pangocairo.h>
#include <librsvg/rsvg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* -------- дрібні хелпери -------- */

static void hex_to_rgb(const char *hex, double *r, double *g, double *b) {
    unsigned int rr = 0, gg = 0, bb = 0;
    if (hex && hex[0] == '#' && strlen(hex) >= 7)
        sscanf(hex + 1, "%02x%02x%02x", &rr, &gg, &bb);
    *r = rr / 255.0; *g = gg / 255.0; *b = bb / 255.0;
}

static void rounded_rect(cairo_t *cr, double x, double y, double w, double h, double r) {
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -M_PI_2, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, M_PI_2);
    cairo_arc(cr, x + r, y + h - r, r, M_PI_2, M_PI);
    cairo_arc(cr, x + r, y + r, r, M_PI, 3 * M_PI_2);
    cairo_close_path(cr);
}

/* Текст через Pango: font — "Extro700 22", реальні .ttf підвантажені
 * fontconfig-конфігом у main() (FcConfigAppFontAddFile), як власні шрифти
 * сторінки через @font-face — той самий принцип, інший API. */
static void draw_text(cairo_t *cr, double x, double y, const char *font_spec,
                       double r, double g, double b, const char *text) {
    PangoLayout *layout = pango_cairo_create_layout(cr);
    PangoFontDescription *desc = pango_font_description_from_string(font_spec);
    pango_layout_set_font_description(layout, desc);
    pango_layout_set_text(layout, text, -1);
    cairo_set_source_rgb(cr, r, g, b);
    cairo_move_to(cr, x, y);
    pango_cairo_show_layout(cr, layout);
    pango_font_description_free(desc);
    g_object_unref(layout);
}

/* Ширина рядка, щоб центрувати (бейдж-ціна, кнопка «як це працює» тощо). */
static void text_extents(const char *font_spec, const char *text, int *w, int *h) {
    cairo_surface_t *tmp = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 1, 1);
    cairo_t *cr = cairo_create(tmp);
    PangoLayout *layout = pango_cairo_create_layout(cr);
    PangoFontDescription *desc = pango_font_description_from_string(font_spec);
    pango_layout_set_font_description(layout, desc);
    pango_layout_set_text(layout, text, -1);
    pango_layout_get_pixel_size(layout, w, h);
    pango_font_description_free(desc);
    g_object_unref(layout);
    cairo_destroy(cr);
    cairo_surface_destroy(tmp);
}

static void draw_text_centered(cairo_t *cr, double cx, double cy, const char *font_spec,
                                double r, double g, double b, const char *text) {
    int w, h;
    text_extents(font_spec, text, &w, &h);
    draw_text(cr, cx - w / 2.0, cy - h / 2.0, font_spec, r, g, b, text);
}

/* SVG-актив (лого, QR) — рендериться один раз у вказаний прямокутник.
 * Реюзаємо справжню векторну графіку сторінки замість перемальовування
 * лого руками: design/brandbook, урізаний у assets/logo.svg й qr.svg. */
static void draw_svg_asset(cairo_t *cr, const char *path, double x, double y, double w, double h) {
    GError *err = NULL;
#if LIBRSVG_CHECK_VERSION(2, 52, 0)
    RsvgHandle *h_svg = rsvg_handle_new_from_file(path, &err);
#else
    RsvgHandle *h_svg = rsvg_handle_new_from_file(path, &err);
#endif
    if (!h_svg) {
        fprintf(stderr, "render: не вдалось відкрити %s: %s\n", path, err ? err->message : "?");
        if (err) g_error_free(err);
        return;
    }
    RsvgDimensionData dim;
    rsvg_handle_get_dimensions(h_svg, &dim);
    cairo_save(cr);
    cairo_translate(cr, x, y);
    cairo_scale(cr, w / dim.width, h / dim.height);
    G_GNUC_BEGIN_IGNORE_DEPRECATIONS
    rsvg_handle_render_cairo(h_svg, cr);
    G_GNUC_END_IGNORE_DEPRECATIONS
    cairo_restore(cr);
    g_object_unref(h_svg);
}

/* -------- чашка: одна реалізація, два споживачі --------
 * Викликається і при малюванні фону (у стані спокою — так дешевше, ніж
 * тримати 12 живих текстур завжди), і при генерації окремого спрайту
 * для анімованого шару. cx,cy — верхній лівий кут .cup (104×120). */
static void draw_cup(cairo_t *cr, double cx, double cy, const char *color_hex, int foam) {
    double r, g, b;

    /* .rim — style.css:42, спочатку, бо в CSS воно РАНІШЕ .liq в потоці,
     * та порядок малювання тут відтворює порядок append у app.js render():
     * body → liq → (foam) → rim. Rim останній і трохи перекриває вінця. */
    cairo_save(cr);
    cairo_translate(cr, cx, cy);

    /* .body */
    rounded_rect(cr, 0, CUP_BODY_Y, CUP_BODY_SIZE, CUP_BODY_SIZE, 10.0);
    cairo_set_source_rgb(cr, CUP_BODY_R, CUP_BODY_G, CUP_BODY_B);
    cairo_fill(cr);

    /* .liq — border-radius 2px 2px 22px 22px: майже прямі верхні кути,
     * округлі нижні, як налита рідина. */
    hex_to_rgb(color_hex, &r, &g, &b);
    cairo_new_sub_path(cr);
    double lx = CUP_LIQ_X, ly = CUP_LIQ_Y, lw = CUP_LIQ_W, lh = CUP_LIQ_H;
    double rt = 2.0, rb = 22.0;
    cairo_move_to(cr, lx + rt, ly);
    cairo_line_to(cr, lx + lw - rt, ly);
    cairo_arc(cr, lx + lw - rt, ly + rt, rt, -M_PI_2, 0);
    cairo_line_to(cr, lx + lw, ly + lh - rb);
    cairo_arc(cr, lx + lw - rb, ly + lh - rb, rb, 0, M_PI_2);
    cairo_line_to(cr, lx + rb, ly + lh);
    cairo_arc(cr, lx + rb, ly + lh - rb, rb, M_PI_2, M_PI);
    cairo_line_to(cr, lx, ly + rt);
    cairo_arc(cr, lx + rt, ly + rt, rt, M_PI, 3 * M_PI_2);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, r, g, b);
    cairo_fill(cr);

    /* .foam */
    if (foam) {
        rounded_rect(cr, CUP_LIQ_X, CUP_FOAM_Y, CUP_LIQ_W, CUP_FOAM_H, 7.0);
        cairo_set_source_rgb(cr, CUP_FOAM_R, CUP_FOAM_G, CUP_FOAM_B);
        cairo_fill(cr);
    }

    /* .rim — еліпс-обвід зверху, border-radius 54px/8px = дуже сплюснутий овал */
    cairo_save(cr);
    cairo_translate(cr, CUP_RIM_X + CUP_RIM_W / 2.0, CUP_RIM_Y + CUP_RIM_H / 2.0);
    cairo_scale(cr, CUP_RIM_W / 2.0, CUP_RIM_H / 2.0);
    cairo_arc(cr, 0, 0, 1.0, 0, 2 * M_PI);
    cairo_restore(cr);
    cairo_set_source_rgb(cr, CUP_BODY_R, CUP_BODY_G, CUP_BODY_B);
    cairo_fill(cr);

    cairo_restore(cr);
}

cairo_surface_t *render_cup_sprite(const char *color_hex, int foam) {
    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32,
                                                      (int)CUP_W, (int)CUP_H);
    cairo_t *cr = cairo_create(s);
    draw_cup(cr, 0, 0, color_hex, foam);
    cairo_destroy(cr);
    return s;
}

/* -------- фон: сітка карток, лого, бічна панель -------- */

cairo_surface_t *render_background(const menu_t *menu, const char *assets_dir,
                                    cup_slot_t slots_out[MENU_MAX_DRINKS]) {
    cairo_surface_t *surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, STAGE_W, STAGE_H);
    cairo_t *cr = cairo_create(surf);

    cairo_set_source_rgb(cr, STAGE_BG_R, STAGE_BG_G, STAGE_BG_B);
    cairo_paint(cr);

    char path[1024];
    snprintf(path, sizeof(path), "%s/logo.svg", assets_dir);
    draw_svg_asset(cr, path, HEAD_X, HEAD_Y, LOGO_W, LOGO_H);

    for (int i = 0; i < menu->drink_count && i < CARD_MAX; i++) {
        int col = i % GRID_COLS, row = i / GRID_COLS;
        double cx = GRID_X + col * (CARD_W + CARD_GAP_X);
        double cy = GRID_Y + row * (CARD_H + CARD_GAP_Y);
        const drink_t *d = &menu->drinks[i];

        rounded_rect(cr, cx, cy, CARD_W, CARD_H, CARD_RADIUS);
        cairo_set_source_rgb(cr, CARD_BG_R, CARD_BG_G, CARD_BG_B);
        cairo_fill_preserve(cr);
        cairo_set_source_rgba(cr, 1, 1, 1, CARD_BORDER_A);
        cairo_set_line_width(cr, 1.0);
        cairo_stroke(cr);

        /* .card:after — верхня смужка-акцент */
        cairo_save(cr);
        rounded_rect(cr, cx, cy, CARD_W, CARD_H, CARD_RADIUS);
        cairo_clip(cr);
        cairo_rectangle(cr, cx, cy, CARD_W, CARD_TOPBAR_H);
        cairo_set_source_rgb(cr, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
        cairo_fill(cr);
        cairo_restore(cr);

        /* .badge — ціна */
        double bx = cx + CARD_W - BADGE_SIZE - 12.0, by = cy + BADGE_TOP;
        rounded_rect(cr, bx, by, BADGE_SIZE, BADGE_SIZE, BADGE_SIZE / 2.0);
        cairo_set_source_rgb(cr, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
        cairo_fill(cr);
        char price[16];
        snprintf(price, sizeof(price), "%d", d->price);
        draw_text_centered(cr, bx + BADGE_SIZE / 2.0, by + BADGE_SIZE / 2.0,
                            FONT_900 " 20", 1, 1, 1, price);

        /* координати чашки в СЦЕНІ — саме їх повертаємо назовні для GLES-шару */
        double cup_x = cx + CUP_X_OFFSET, cup_y = cy + CUP_Y_OFFSET;
        if (slots_out) { slots_out[i].x = cup_x; slots_out[i].y = cup_y; }
        draw_cup(cr, cup_x, cup_y, d->color, d->foam);

        draw_text(cr, cx + NAME_X, cy + CARD_H - NAME_BOTTOM, FONT_700 " 15",
                   TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, d->name);
        char vol[MENU_STR + 8];
        snprintf(vol, sizeof(vol), "%s  %s", d->vol, d->cup);
        draw_text(cr, cx + VOL_X, cy + CARD_H - VOL_BOTTOM - 6, FONT_400 " 13",
                   TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, vol);
    }

    /* бічна панель — спрощено відносно HTML (без покрокових іконок-кіл
     * і платіжних тайлів у v1 спайку): суцільна панель, заголовок, QR. */
    rounded_rect(cr, SIDE_X, SIDE_Y, SIDE_W, SIDE_H, SIDE_R);
    cairo_set_source_rgb(cr, SIDE_BG_R, SIDE_BG_G, SIDE_BG_B);
    cairo_fill(cr);

    cairo_pattern_t *grad = cairo_pattern_create_linear(SIDE_X + HOWTO_X, 0,
                                                          SIDE_X + HOWTO_X + HOWTO_W, 0);
    cairo_pattern_add_color_stop_rgb(grad, 0.0, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
    cairo_pattern_add_color_stop_rgb(grad, 1.0, 0xFF / 255.0, 0x2D / 255.0, 0x6F / 255.0);
    rounded_rect(cr, SIDE_X + HOWTO_X, SIDE_Y + HOWTO_Y, HOWTO_W, HOWTO_H, HOWTO_R);
    cairo_set_source(cr, grad);
    cairo_fill(cr);
    cairo_pattern_destroy(grad);
    draw_text_centered(cr, SIDE_X + HOWTO_X + HOWTO_W / 2.0, SIDE_Y + HOWTO_Y + HOWTO_H / 2.0,
                        FONT_900 " 18", 1, 1, 1, "ЯК ЦЕ ПРАЦЮЄ");

    snprintf(path, sizeof(path), "%s/qr.svg", assets_dir);
    draw_svg_asset(cr, path, SIDE_X + QRBOX_X, SIDE_Y + QRBOX_Y, QR_SIZE, QR_SIZE);
    draw_text(cr, SIDE_X + QRBOX_X + QR_SIZE + 24, SIDE_Y + QRBOX_Y + 24, FONT_900 " 20",
               BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B, "Вирости кавенятко");
    draw_text(cr, SIDE_X + QRBOX_X + QR_SIZE + 24, SIDE_Y + QRBOX_Y + 60, FONT_400 " 15",
               TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, "extrovert.cafe");

    if (menu->brand_name[0]) {
        char brand[MENU_STR * 2];
        snprintf(brand, sizeof(brand), "%s%s", menu->brand_name, menu->brand_suffix);
        /* поки тільки для налагодження — на екрані лого вже несе бренд */
        (void)brand;
    }

    cairo_destroy(cr);
    return surf;
}

cairo_surface_t *render_popup(const char *title, const char *text) {
    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32,
                                                      (int)POPUP_W, (int)POPUP_H);
    cairo_t *cr = cairo_create(s);
    rounded_rect(cr, 0, 0, POPUP_W, POPUP_H, POPUP_R);
    cairo_set_source_rgba(cr, 0x12 / 255.0, 0x10 / 255.0, 0x0F / 255.0, POPUP_BG_A);
    cairo_fill_preserve(cr);
    cairo_set_source_rgba(cr, 1, 1, 1, 0.18);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    draw_text_centered(cr, POPUP_W / 2.0, POPUP_H / 2.0 - 26, FONT_600 " 34",
                        TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, title);
    draw_text_centered(cr, POPUP_W / 2.0, POPUP_H / 2.0 + 22, FONT_400 " 20",
                        TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, text);

    cairo_destroy(cr);
    return s;
}
