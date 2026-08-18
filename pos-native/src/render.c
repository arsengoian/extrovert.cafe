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

/* .name{width:252px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 * — довгі назви напоїв («Гарячий шоколад», «Американо з бонусами») інакше
 * лізуть під сусідню картку, бо Cairo/Pango самі нічого не обрізають. */
static void draw_text_ellipsized(cairo_t *cr, double x, double y, const char *font_spec,
                                  double r, double g, double b, const char *text, double max_w) {
    PangoLayout *layout = pango_cairo_create_layout(cr);
    PangoFontDescription *desc = pango_font_description_from_string(font_spec);
    pango_layout_set_font_description(layout, desc);
    pango_layout_set_text(layout, text, -1);
    pango_layout_set_width(layout, (int)(max_w * PANGO_SCALE));
    pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_END);
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

        /* .card:after — верхня смужка-акцент, горизонтальний градієнт з опацією .55 */
        cairo_save(cr);
        rounded_rect(cr, cx, cy, CARD_W, CARD_H, CARD_RADIUS);
        cairo_clip(cr);
        cairo_rectangle(cr, cx, cy, CARD_W, CARD_TOPBAR_H);
        cairo_pattern_t *topbar = cairo_pattern_create_linear(cx, 0, cx + CARD_W, 0);
        cairo_pattern_add_color_stop_rgba(topbar, 0.0, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B, 0.55);
        cairo_pattern_add_color_stop_rgba(topbar, 1.0, ACCENT2_R, ACCENT2_G, ACCENT2_B, 0.55);
        cairo_set_source(cr, topbar);
        cairo_fill(cr);
        cairo_pattern_destroy(topbar);
        cairo_restore(cr);

        /* .badge — ціна, вертикальний градієнт top→bottom */
        double bx = cx + CARD_W - BADGE_SIZE - 12.0, by = cy + BADGE_TOP;
        rounded_rect(cr, bx, by, BADGE_SIZE, BADGE_SIZE, BADGE_SIZE / 2.0);
        cairo_pattern_t *badge_grad = cairo_pattern_create_linear(0, by, 0, by + BADGE_SIZE);
        cairo_pattern_add_color_stop_rgb(badge_grad, 0.0, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
        cairo_pattern_add_color_stop_rgb(badge_grad, 1.0, ACCENT2_R, ACCENT2_G, ACCENT2_B);
        cairo_set_source(cr, badge_grad);
        cairo_fill(cr);
        cairo_pattern_destroy(badge_grad);
        char price[16], badge_font[32];
        snprintf(price, sizeof(price), "%d", d->price);
        snprintf(badge_font, sizeof(badge_font), FONT_900 " %d", BADGE_FONT_SIZE);
        draw_text_centered(cr, bx + BADGE_SIZE / 2.0, by + BADGE_SIZE / 2.0,
                            badge_font, 1, 1, 1, price);

        /* координати чашки в СЦЕНІ — саме їх повертаємо назовні для GLES-шару */
        double cup_x = cx + CUP_X_OFFSET, cup_y = cy + CUP_Y_OFFSET;
        if (slots_out) { slots_out[i].x = cup_x; slots_out[i].y = cup_y; }
        draw_cup(cr, cup_x, cup_y, d->color, d->foam);

        char name_font[32], vol_font[32];
        snprintf(name_font, sizeof(name_font), FONT_700 " %d", NAME_FONT_SIZE);
        snprintf(vol_font, sizeof(vol_font), FONT_400 " %d", VOL_FONT_SIZE);
        /* CSS `.name{bottom:40px}` anchors the BOTTOM of the text box, i.e. the
         * text sits above that line. draw_text()'s y is a top-left corner, so
         * the box has to be pushed up by its own measured height — passing
         * cy+CARD_H-NAME_BOTTOM directly (the old code) drew it growing
         * downward instead, crowding into the .vol line below. */
        int name_w, name_h;
        text_extents(name_font, d->name, &name_w, &name_h);
        draw_text_ellipsized(cr, cx + NAME_X, cy + CARD_H - NAME_BOTTOM - name_h, name_font,
                              TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, d->name, NAME_MAX_W);

        /* .vol саме сам обʼєм; розмір стакана йде окремим бейджем .cupTag
         * поруч, кольором за d.cups[cup].where (app.js:138-142) — не
         * дописаний текстом, як було раніше. */
        int vol_w, vol_h;
        text_extents(vol_font, d->vol, &vol_w, &vol_h);
        double vol_y = cy + CARD_H - VOL_BOTTOM - vol_h;
        draw_text(cr, cx + VOL_X, vol_y, vol_font, TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, d->vol);

        const cup_tier_t *tier = menu_find_cup(menu, d->cup);
        if (tier) {
            char tag_font[32];
            snprintf(tag_font, sizeof(tag_font), FONT_700 " %d", CUPTAG_FONT_SIZE);
            int tag_w, tag_h;
            text_extents(tag_font, tier->short_label, &tag_w, &tag_h);
            double pill_w = tag_w + 2 * CUPTAG_PAD_X;
            double pill_x = cx + VOL_X + vol_w + CUPTAG_GAP;
            double pill_y = vol_y + vol_h / 2.0 - CUPTAG_H / 2.0 + 2.0;
            rounded_rect(cr, pill_x, pill_y, pill_w, CUPTAG_H, CUPTAG_R);
            if (tier->organizer)
                cairo_set_source_rgb(cr, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
            else
                cairo_set_source_rgb(cr, CUPTAG_GREEN_R, CUPTAG_GREEN_G, CUPTAG_GREEN_B);
            cairo_fill(cr);
            double tr = tier->organizer ? 1.0 : CUPTAG_DARK_R;
            double tg = tier->organizer ? 1.0 : CUPTAG_DARK_G;
            double tb = tier->organizer ? 1.0 : CUPTAG_DARK_B;
            draw_text_centered(cr, pill_x + pill_w / 2.0, pill_y + CUPTAG_H / 2.0,
                                tag_font, tr, tg, tb, tier->short_label);
        }
    }

    /* -------- бічна панель -------- */
    rounded_rect(cr, SIDE_X, SIDE_Y, SIDE_W, SIDE_H, SIDE_R);
    cairo_set_source_rgb(cr, SIDE_BG_R, SIDE_BG_G, SIDE_BG_B);
    cairo_fill(cr);

    char howto_font[32];
    snprintf(howto_font, sizeof(howto_font), FONT_900 " %d", HOWTO_FONT_SIZE);
    cairo_pattern_t *grad = cairo_pattern_create_linear(0, SIDE_Y + HOWTO_Y, 0, SIDE_Y + HOWTO_Y + HOWTO_H);
    cairo_pattern_add_color_stop_rgb(grad, 0.0, BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B);
    cairo_pattern_add_color_stop_rgb(grad, 1.0, ACCENT2_R, ACCENT2_G, ACCENT2_B);
    rounded_rect(cr, SIDE_X + HOWTO_X, SIDE_Y + HOWTO_Y, HOWTO_W, HOWTO_H, HOWTO_R);
    cairo_set_source(cr, grad);
    cairo_fill(cr);
    cairo_pattern_destroy(grad);
    draw_text_centered(cr, SIDE_X + HOWTO_X + HOWTO_W / 2.0, SIDE_Y + HOWTO_Y + HOWTO_H / 2.0,
                        howto_font, 1, 1, 1, "ЯК ЦЕ ПРАЦЮЄ");

    /* #steps — три кроки, круг-номер + підпис. Координати — ручний
     * normal-flow прорахунок, дивись коментар при STEPS_TOP у config.h. */
    char step_num_font[32], step_label_font[32];
    snprintf(step_num_font, sizeof(step_num_font), FONT_900 " %d", STEP_NUM_FONT_SIZE);
    snprintf(step_label_font, sizeof(step_label_font), FONT_600 " %d", STEP_LABEL_FONT_SIZE);
    for (int i = 0; i < menu->step_count; i++) {
        double sx = SIDE_X + STEP_LEFT;
        double sy = SIDE_Y + STEPS_TOP + (i + 1) * STEP_MARGIN_TOP + i * STEP_H;
        double r, g, b;
        switch (i % 3) {
            case 0: r = BADGE_COLOR_R; g = BADGE_COLOR_G; b = BADGE_COLOR_B; break;
            case 1: r = 0xFF / 255.0; g = 0x5A / 255.0; b = 0x3C / 255.0; break;
            default: r = ACCENT2_R; g = ACCENT2_G; b = ACCENT2_B; break;
        }
        cairo_new_sub_path(cr);
        cairo_arc(cr, sx + STEP_CIRCLE_SIZE / 2.0, sy + STEP_CIRCLE_SIZE / 2.0,
                  (STEP_CIRCLE_SIZE - STEP_BORDER_W) / 2.0, 0, 2 * M_PI);
        cairo_set_source_rgb(cr, r, g, b);
        cairo_set_line_width(cr, STEP_BORDER_W);
        cairo_stroke(cr);
        char num[4];
        snprintf(num, sizeof(num), "%d", i + 1);
        draw_text_centered(cr, sx + STEP_CIRCLE_SIZE / 2.0, sy + STEP_CIRCLE_SIZE / 2.0,
                            step_num_font, r, g, b, num);
        draw_text(cr, sx + STEP_TEXT_X, sy + STEP_TEXT_Y, step_label_font,
                   TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, menu->steps[i]);
    }

    /* .slabel + #pays + #cash — під кроками, у тому ж ручному потоці */
    double steps_bottom = SIDE_Y + STEPS_TOP + menu->step_count * (STEP_MARGIN_TOP + STEP_H);
    double slabel_y = steps_bottom + SLABEL_MARGIN_TOP;
    char slabel_font[32];
    snprintf(slabel_font, sizeof(slabel_font), FONT_700 " %d", SLABEL_FONT_SIZE);
    draw_text(cr, SIDE_X + SLABEL_LEFT, slabel_y, slabel_font,
               TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, "ОПЛАТА");

    double pays_top = slabel_y + SLABEL_LINE_H + SLABEL_MARGIN_BOTTOM;
    char pay_font[32];
    snprintf(pay_font, sizeof(pay_font), FONT_600 " %d", PAY_FONT_SIZE);
    for (int i = 0; i < menu->payment_count; i++) {
        int col = i % PAY_COLS, row = i / PAY_COLS;
        double px = SIDE_X + PAYS_LEFT + col * (PAY_W + PAY_GAP_X);
        double py = pays_top + row * (PAY_H + PAY_GAP_Y);
        rounded_rect(cr, px, py, PAY_W, PAY_H, 10.0);
        cairo_set_source_rgba(cr, 1, 1, 1, 0.14);
        cairo_set_line_width(cr, 2.0);
        cairo_stroke(cr);
        draw_text_centered(cr, px + PAY_W / 2.0, py + PAY_H / 2.0, pay_font,
                            TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, menu->payments[i]);
    }

    int pay_rows = (menu->payment_count + PAY_COLS - 1) / PAY_COLS;
    double cash_y = pays_top + pay_rows * (PAY_H + PAY_GAP_Y) + CASH_MARGIN_TOP;
    char cash_font[32];
    snprintf(cash_font, sizeof(cash_font), FONT_400 " %d", CASH_FONT_SIZE);
    draw_text(cr, SIDE_X + CASH_LEFT, cash_y, cash_font,
               TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, menu->cash_note);

    /* #qrbox / #qrtext — позиція абсолютна від #side, не залежить від потоку вище */
    snprintf(path, sizeof(path), "%s/qr.svg", assets_dir);
    draw_svg_asset(cr, path, SIDE_X + QRBOX_X, SIDE_Y + QRBOX_Y, QR_SIZE, QR_SIZE);

    double qtx = SIDE_X + QRTEXT_X, qty = SIDE_Y + QRBOX_Y + QRTEXT_Y;
    char qr_font[32], qr_hi_font[32], qr_mut_font[32];
    snprintf(qr_font, sizeof(qr_font), FONT_400 " %d", QRTEXT_FONT_SIZE);
    snprintf(qr_hi_font, sizeof(qr_hi_font), FONT_900 " %d", QRTEXT_FONT_SIZE);
    snprintf(qr_mut_font, sizeof(qr_mut_font), FONT_400 " %d", QRTEXT_MUT_FONT_SIZE);
    draw_text(cr, qtx, qty, qr_font, TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, menu->qr_line1);
    draw_text(cr, qtx, qty + QRTEXT_LINE_H, qr_hi_font,
               BADGE_COLOR_R, BADGE_COLOR_G, BADGE_COLOR_B, menu->qr_line2);
    draw_text(cr, qtx, qty + 2 * QRTEXT_LINE_H, qr_mut_font,
               TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, menu->qr_line3);

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
