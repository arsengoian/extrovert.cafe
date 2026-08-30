#include "render.h"
#include "config.h"
#include "svgtpl.h"
#include <pango/pangocairo.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* -------- текстові хелпери — спільні з bonus.c -------- */

void rounded_rect(cairo_t *cr, double x, double y, double w, double h, double r) {
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -M_PI_2, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, M_PI_2);
    cairo_arc(cr, x + r, y + h - r, r, M_PI_2, M_PI);
    cairo_arc(cr, x + r, y + r, r, M_PI, 3 * M_PI_2);
    cairo_close_path(cr);
}

/* Текст через Pango: font — "Extro700 22px", реальні .ttf підвантажені
 * fontconfig-конфігом у main() (FcConfigAppFontAddFile). "px" суфікс
 * обов'язковий — без нього Pango читає число як пункти при 96dpi
 * (29.08.2026: саме це дало переповнення заголовка реклами). */
void draw_text(cairo_t *cr, double x, double y, const char *font_spec,
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

void draw_text_ellipsized(cairo_t *cr, double x, double y, const char *font_spec,
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

void text_extents(const char *font_spec, const char *text, int *w, int *h) {
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

void draw_text_centered(cairo_t *cr, double cx, double cy, const char *font_spec,
                         double r, double g, double b, const char *text) {
    int w, h;
    text_extents(font_spec, text, &w, &h);
    draw_text(cr, cx - w / 2.0, cy - h / 2.0, font_spec, r, g, b, text);
}

/* dominant-baseline="central" — так само, як в увесь текст макета:
 * y задає центр рядка, не верх box'а, яким оперує draw_text(). */
void draw_text_vc(cairo_t *cr, double x, double y_center, const char *font_spec,
                   double r, double g, double b, const char *text) {
    int w, h;
    text_extents(font_spec, text, &w, &h);
    draw_text(cr, x, y_center - h / 2.0, font_spec, r, g, b, text);
}
void draw_text_vc_ellipsized(cairo_t *cr, double x, double y_center, const char *font_spec,
                              double r, double g, double b, const char *text, double max_w) {
    int w, h;
    text_extents(font_spec, text, &w, &h);
    draw_text_ellipsized(cr, x, y_center - h / 2.0, font_spec, r, g, b, text, max_w);
}

/* -------- меню: лого + сітка карток, зі справжнього SVG-шаблону -------- */

cairo_surface_t *render_menu(const menu_t *menu, const char *assets_dir) {
    char page_path[1024], card_path[1024], card_bonus_path[1024];
    snprintf(page_path, sizeof(page_path), "%s/templates/menu.svg", assets_dir);
    snprintf(card_path, sizeof(card_path), "%s/templates/card.svg", assets_dir);
    snprintf(card_bonus_path, sizeof(card_bonus_path), "%s/templates/card_bonus.svg", assets_dir);

    char *page_tpl = svgtpl_load(page_path);
    char *card_tpl = svgtpl_load(card_path);
    char *card_bonus_tpl = svgtpl_load(card_bonus_path);
    if (!page_tpl || !card_tpl || !card_bonus_tpl) {
        free(page_tpl); free(card_tpl); free(card_bonus_tpl);
        return NULL;
    }

    char name_font[32];
    snprintf(name_font, sizeof(name_font), FONT_700 " %dpx", CARD_NAME_FONT_SIZE);
    char badge_font[32];
    snprintf(badge_font, sizeof(badge_font), FONT_POPPINS " Bold %dpx", CARD_BADGE_FONT_SIZE);

    /* Конкатенація карток у {{CARDS}} сторінки. Верхня межа з запасом:
     * CARD_MAX карток по ~2 КБ найдовшого підставленого фрагмента. */
    size_t cap = (size_t)CARD_MAX * 2048 + 1;
    char *cards = malloc(cap);
    cards[0] = 0;
    size_t used = 0;

    int n = menu->drink_count < CARD_MAX ? menu->drink_count : CARD_MAX;
    for (int i = 0; i < n; i++) {
        const drink_t *d = &menu->drinks[i];
        int col = i % GRID_COLS, row = i / GRID_COLS;
        double tx = GRID_X + col * (CARD_W + CARD_GAP_X);
        double ty = GRID_Y + row * (CARD_H + CARD_GAP_Y);

        char img[1024];
        snprintf(img, sizeof(img), "%s/drinks/%s.png", assets_dir,
                 d->sprite[0] ? d->sprite : "none");

        char *name_esc_raw = svgtpl_esc(d->name);
        char *name = svgtpl_ellipsize(name_esc_raw, name_font, CARD_NAME_MAX_W);
        free(name_esc_raw);
        char *vol = svgtpl_esc(d->vol);

        char txs[16], tys[16], price[24];
        snprintf(txs, sizeof(txs), "%.2f", tx);
        snprintf(tys, sizeof(tys), "%.2f", ty);
        snprintf(price, sizeof(price), "%d \xE2\x82\xB4", d->price);   /* "N ₴" */

        char *card;
        if (d->bonus_coins > 0) {
            /* ширина бейджа — той самий принцип, що монетна пігулка рядка
             * бонусу: рахуємо від виміряного тексту (config.h: CARD_BADGE_*) */
            char coins[16];
            snprintf(coins, sizeof(coins), "%d", d->bonus_coins);
            int ctw;
            text_extents(badge_font, coins, &ctw, NULL);
            double badge_w = CARD_BADGE_ICON_PAD_L + CARD_BADGE_ICON_SIZE +
                              CARD_BADGE_ICON_TEXT_GAP + ctw + CARD_BADGE_PAD_R;
            char badge_w_s[16];
            snprintf(badge_w_s, sizeof(badge_w_s), "%.1f", badge_w);

            const char *keys[] = { "TX", "TY", "IMG", "NAME", "VOL", "PRICE",
                                    "ASSETS", "BONUS_COINS", "BADGE_W" };
            const char *vals[] = { txs, tys, img, name, vol, price,
                                    assets_dir, coins, badge_w_s };
            card = svgtpl_sub(card_bonus_tpl, keys, vals, 9);
        } else {
            const char *keys[] = { "TX", "TY", "IMG", "NAME", "VOL", "PRICE" };
            const char *vals[] = { txs, tys, img, name, vol, price };
            card = svgtpl_sub(card_tpl, keys, vals, 6);
        }
        free(name);
        free(vol);

        if (card) {
            size_t clen = strlen(card);
            if (used + clen + 1 <= cap) {
                memcpy(cards + used, card, clen + 1);
                used += clen;
            }
            free(card);
        }
    }
    free(card_tpl);
    free(card_bonus_tpl);

    char assets_esc[1024];
    snprintf(assets_esc, sizeof(assets_esc), "%s", assets_dir);
    const char *pkeys[] = { "ASSETS", "CARDS" };
    const char *pvals[] = { assets_esc, cards };
    char *full = svgtpl_sub(page_tpl, pkeys, pvals, 2);
    free(page_tpl);
    free(cards);
    if (!full) return NULL;

    cairo_surface_t *surf = svgtpl_render(full, STAGE_W, STAGE_H, assets_dir);
    free(full);
    return surf;
}

/* -------- реклама: окремий SVG-шаблон -------- */

cairo_surface_t *render_ad(const menu_t *menu, const char *assets_dir) {
    if (!menu->ad.valid) return NULL;

    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/ad.svg", assets_dir);
    char *tpl = svgtpl_load(path);
    if (!tpl) return NULL;

    char head_font[32];
    snprintf(head_font, sizeof(head_font), FONT_1000 " %dpx", AD_HEAD_FONT_SIZE);

    char *promo = svgtpl_esc(menu->ad.promo_label);
    char *h1_raw = svgtpl_esc(menu->ad.head1);
    char *h1 = svgtpl_ellipsize(h1_raw, head_font, AD_HEAD_MAX_W);
    free(h1_raw);
    char *h2_raw = svgtpl_esc(menu->ad.head2);
    char *h2 = svgtpl_ellipsize(h2_raw, head_font, AD_HEAD_MAX_W);
    free(h2_raw);
    char *sub = svgtpl_esc(menu->ad.sub);
    char *fine = svgtpl_esc(menu->ad.fine);

    char hero[1024];
    snprintf(hero, sizeof(hero), "%s/drinks-ad/%s.png", assets_dir,
             menu->ad.sprite[0] ? menu->ad.sprite : "none");

    const char *keys[] = { "PROMO_LABEL", "HEAD1", "HEAD2", "SUB", "FINE", "HERO_IMG" };
    const char *vals[] = { promo, h1, h2, sub, fine, hero };
    char *full = svgtpl_sub(tpl, keys, vals, 6);
    free(tpl);
    free(promo); free(h1); free(h2); free(sub); free(fine);
    if (!full) return NULL;

    cairo_surface_t *surf = svgtpl_render(full, (int)PANEL_W, (int)AD_H, assets_dir);
    free(full);
    return surf;
}

/* -------- попап: без дизайну поки що, лишається прямим Cairo -------- */

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

    draw_text_centered(cr, POPUP_W / 2.0, POPUP_H / 2.0 - 26, FONT_600 " 34px",
                        TEXT_FG_R, TEXT_FG_G, TEXT_FG_B, title);
    draw_text_centered(cr, POPUP_W / 2.0, POPUP_H / 2.0 + 22, FONT_400 " 20px",
                        TEXT_MUTED_R, TEXT_MUTED_G, TEXT_MUTED_B, text);

    cairo_destroy(cr);
    return s;
}
