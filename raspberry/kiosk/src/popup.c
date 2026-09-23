#include "popup.h"
#include "config.h"
#include "svgtpl.h"
#include "qr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

bool popup_art_init(popup_art_t *p, const char *assets_dir) {
    if (p->base) return true;
    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/popup.svg", assets_dir);
    char *tpl = svgtpl_load(path);
    if (!tpl) return false;

    const char *keys[] = { "ASSETS" };
    const char *vals[] = { assets_dir };
    char *full = svgtpl_sub(tpl, keys, vals, 1);
    free(tpl);
    if (!full) return false;

    p->base = svgtpl_render(full, (int)POPUP_W, (int)POPUP_H, assets_dir);
    free(full);
    if (!p->base) fprintf(stderr, "popup: основа не відрендерилась (%s)\n", path);
    return p->base != NULL;
}

/* Шар плиток (popup_bonus.svg). Окремо від основи — пояснення в popup.h. */
static cairo_surface_t *render_bonus_layer(const char *assets_dir, const bonus_popup_t *b) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/popup_bonus.svg", assets_dir);
    char *tpl = svgtpl_load(path);
    if (!tpl) return NULL;

    /* Плитка предмета — окремий фрагмент або нічого: у svgtpl немає умов,
     * варіанти вибираються тут, як card.svg / card_bonus.svg у render.c. */
    char *secret = NULL;
    if (b->secret) {
        snprintf(path, sizeof(path), "%s/templates/popup_secret.svg", assets_dir);
        secret = svgtpl_load(path);
    }

    char coins[16], tile_tx[16];
    snprintf(coins, sizeof(coins), "%d", b->coins);
    /* -52 / 0 — з макета: пара плиток симетрична відносно центру, самотня
     * плитка монет стоїть рівно по центру. */
    snprintf(tile_tx, sizeof(tile_tx), "%d", secret ? -52 : 0);

    const char *keys[] = { "ASSETS", "COINS", "COIN_TILE_TX", "SECRET_TILE" };
    const char *vals[] = { assets_dir, coins, tile_tx, secret ? secret : "" };
    char *full = svgtpl_sub(tpl, keys, vals, 4);
    free(tpl);
    free(secret);
    if (!full) return NULL;

    cairo_surface_t *s = svgtpl_render(full, (int)POPUP_BONUS_W, (int)POPUP_BONUS_H, assets_dir);
    free(full);
    return s;
}

/* Плашка «Бонус отримано». Малюється на тому самому полотні POPUP_W×POPUP_H,
 * що й звичайний попап, тільки прозорому: main.c не мусить знати про другий
 * розмір — центрування, поява й зникання лишаються спільними. */
static cairo_surface_t *render_taken(const char *assets_dir) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/templates/popup_taken.svg", assets_dir);
    char *tpl = svgtpl_load(path);
    if (!tpl) return NULL;
    const char *keys[] = { "ASSETS" };
    const char *vals[] = { assets_dir };
    char *full = svgtpl_sub(tpl, keys, vals, 1);
    free(tpl);
    if (!full) return NULL;

    cairo_surface_t *plate = svgtpl_render(full, (int)POPUP_TAKEN_W, (int)POPUP_TAKEN_H, assets_dir);
    free(full);
    if (!plate) { fprintf(stderr, "popup: плашка «отримано» не відрендерилась (%s)\n", path); return NULL; }

    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, (int)POPUP_W, (int)POPUP_H);
    cairo_t *cr = cairo_create(s);
    cairo_set_source_surface(cr, plate, (POPUP_W - POPUP_TAKEN_W) / 2.0, (POPUP_H - POPUP_TAKEN_H) / 2.0);
    cairo_paint(cr);
    cairo_destroy(cr);
    cairo_surface_destroy(plate);
    return s;
}

cairo_surface_t *popup_render(popup_art_t *p, const char *assets_dir, const bonus_popup_t *b) {
    if (b->taken) return render_taken(assets_dir);
    if (!p->base && !popup_art_init(p, assets_dir)) return NULL;

    cairo_surface_t *layer = render_bonus_layer(assets_dir, b);
    if (!layer) fprintf(stderr, "popup: шар плиток не відрендерився — показую без нього\n");

    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, (int)POPUP_W, (int)POPUP_H);
    cairo_t *cr = cairo_create(s);
    cairo_set_source_surface(cr, p->base, 0, 0);
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);   /* поверхня порожня — чиста копія, без змішування */
    cairo_paint(cr);
    if (layer) {
        cairo_set_operator(cr, CAIRO_OPERATOR_OVER);
        cairo_set_source_surface(cr, layer, POPUP_BONUS_X, POPUP_BONUS_Y);
        cairo_paint(cr);
        cairo_surface_destroy(layer);
    }
    cairo_set_operator(cr, CAIRO_OPERATOR_OVER);
    qr_paint(cr, b->qr_payload, QR_POPUP_X, QR_POPUP_Y, QR_POPUP_SIZE);
    cairo_destroy(cr);
    return s;
}

void popup_art_destroy(popup_art_t *p) {
    if (p->base) cairo_surface_destroy(p->base);
    p->base = NULL;
}
