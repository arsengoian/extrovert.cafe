/* render.h — редизайн 29.08.2026: меню й реклама тепер компонуються зі
 * справжніх SVG-шаблонів (svgtpl.c/h, assets/templates/) замість
 * ручних Cairo-викликів. Тут лишились: (1) дві точки входу, що збирають
 * і рендерять шаблони, (2) текстові хелпери, спільні з bonus.c (bonus.c
 * досі малює прямим Cairo смугу прогресу й відлік — вони змінюються
 * щосекунди). Попап — окремо, popup.c. */
#ifndef POS_NATIVE_RENDER_H
#define POS_NATIVE_RENDER_H

#include <cairo/cairo.h>
#include "menu.h"

/* Уся сітка меню (лого + до CARD_MAX карток) — один SVG-документ
 * (templates/menu.svg + card.svg на кожну картку), рендерений у Cairo-
 * поверхню STAGE_W×STAGE_H. NULL при помилці (шаблон не знайдено/битий
 * SVG) — виклик тоді лишає попередню текстуру, як і завжди робив
 * menu_poll() при мережевій помилці. */
cairo_surface_t *render_menu(const menu_t *menu, const char *assets_dir);

/* Рекламна картка (templates/ad.svg), окрема текстура PANEL_W×AD_H —
 * своя, бо композититься окремим квадом поруч із меню. NULL, якщо
 * menu->ad.valid==false (нема чого рендерити) або шаблон не знайдено. */
cairo_surface_t *render_ad(const menu_t *menu, const char *assets_dir);

/* -------- спільне з bonus.c -------- */
void rounded_rect(cairo_t *cr, double x, double y, double w, double h, double r);
void draw_text(cairo_t *cr, double x, double y, const char *font_spec,
               double r, double g, double b, const char *text);
void draw_text_ellipsized(cairo_t *cr, double x, double y, const char *font_spec,
                           double r, double g, double b, const char *text, double max_w);
void text_extents(const char *font_spec, const char *text, int *w, int *h);
void draw_text_centered(cairo_t *cr, double cx, double cy, const char *font_spec,
                         double r, double g, double b, const char *text);
void draw_text_vc(cairo_t *cr, double x, double y_center, const char *font_spec,
                   double r, double g, double b, const char *text);
void draw_text_vc_ellipsized(cairo_t *cr, double x, double y_center, const char *font_spec,
                              double r, double g, double b, const char *text, double max_w);

/* Плашка "оновлення" в шапці (update.h). Ширина рахується з тексту, тому
 * повертається через *out_w — композитор має знати квад, у який класти
 * текстуру. Прозорий фон: лягає поверх уже намальованого меню. */
cairo_surface_t *render_update_banner(const char *label, double *out_w);

#endif
