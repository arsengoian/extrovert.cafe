/* popup.h — попап «Кава готується / А тобі — бонус!» з фінального макета
 * (design/monitor-menu/Monitor Menu SVG.dc.html, 21.09.2026). Замінив обидва
 * тимчасові попапи, що малювались прямим Cairo: generic «Готуємо / Постав
 * стакан під кран» і «+N монет — напій».
 *
 * Два шари, свідомо:
 *   - основа (templates/popup.svg, 1200×888): панель, заголовки, кавенятко,
 *     бульбашка, кільце під QR. Однакова для всіх бонусів, тож рендериться
 *     ОДИН раз на старті й лежить у памʼяті Cairo-поверхнею;
 *   - змінна частина (templates/popup_bonus.svg, 200×130): плитка монет і
 *     плитка «секретний предмет» (popup_secret.svg). Рендериться на кожен
 *     бонус і малюється поверх копії основи, а QR поверх неї — прямим Cairo
 *     (qr.h пояснює, чому не SVG).
 * На Pi 1 основа рендериться ~2 с (виміряно selftest-ом 21.09.2026), і
 * стільки ж стояв би кадр саме тоді, коли біля екрана стоїть клієнт. Копія
 * готової основи й маленький шар зверху — у рази дешевше.
 *
 * Затемнення під попапом (#040608 · 0,8 на весь екран) — не тут: це окремий
 * GL-квад у main.c, щоб не тримати ще одну 1920×1080 текстуру на GPU.
 */
#ifndef POS_NATIVE_POPUP_H
#define POS_NATIVE_POPUP_H

#include <cairo/cairo.h>
#include <stdbool.h>

/* Вміст попапу. Заповнює bonus.c: з події ws, з емуляції або демо-даними. */
typedef struct {
    int coins;
    bool secret;               /* плитка «+ Секретний предмет» */
    char qr_payload[128];
} bonus_popup_t;

typedef struct {
    cairo_surface_t *base;     /* popup.svg, NULL якщо ще не вдалось */
} popup_art_t;

/* Рендерить основу. false — шаблон не знайдено чи битий; popup_render()
 * тоді спробує ще раз сам, тож кіоск не мусить на цьому зупинятись. */
bool popup_art_init(popup_art_t *p, const char *assets_dir);

/* Готовий попап POPUP_W×POPUP_H для gl_texture_from_cairo(). NULL при
 * помилці — main.c тоді просто не показує попап (бонус у панелі лишається). */
cairo_surface_t *popup_render(popup_art_t *p, const char *assets_dir, const bonus_popup_t *b);

void popup_art_destroy(popup_art_t *p);

#endif
