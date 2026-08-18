/* render.h — вміст, малюється Cairo/Pango. Рідкісна операція (раз на
 * оновлення цін), тому дозволено бути "дорогою" за мірками кадру. */
#ifndef POS_NATIVE_RENDER_H
#define POS_NATIVE_RENDER_H

#include <cairo/cairo.h>
#include "menu.h"

typedef struct {
    double x, y;      /* верхній лівий кут .cup відносно сцени (не картки) */
} cup_slot_t;

/* Малює повний кадр 1920×1080 БЕЗ чашок (вони — окремий шар зверху,
 * що анімується; якщо намалювати їх тут, у спокої вони збігаються з фоном
 * пікселем у піксель, а рухаються — вже як власна текстура). */
cairo_surface_t *render_background(const menu_t *menu, const char *assets_dir,
                                    cup_slot_t slots_out[MENU_MAX_DRINKS]);

/* Одна чашка на прозорому фоні CUP_W×CUP_H — той самий draw_cup(), яким
 * малюється й фон, винесений окремо, щоб не було двох реалізацій вигляду
 * чашки, які можуть розійтись. */
cairo_surface_t *render_cup_sprite(const char *color_hex, int foam);

/* Панель попапу POPUP_W×POPUP_H, прозорий фон. */
cairo_surface_t *render_popup(const char *title, const char *text);

#endif
