/* bonus.h — рядки бонусів у правій панелі: QR, смуга прогресу, зворотний
 * відлік. Джерело подій буде WebSocket (libwebsockets, поки не підключений
 * — протокол/сервер ще не готові); bonus_tick_emulate() тимчасово грає
 * його роль, додаючи випадковий бонус раз на BONUS_EMULATE_PERIOD_S.
 * Коли зʼявиться реальний ws-клієнт, bonus_tick_emulate() заміниться на
 * функцію, що розбирає вхідну подію протоколу й так само населяє
 * bonus_row_t — контракт назовні (bonus_update/bonus_draw) лишається
 * тим самим.
 *
 * Три різні тактовки перемальовування в одному рядку, свідомо:
 *   - фон/мініатюра/назва/монетна пігулка — SVG-шаблон (assets/templates/
 *     bonus_row.svg, svgtpl.c), пече раз при появі бонусу (не змінюються
 *     все життя рядка);
 *   - текст таймера — раз на секунду, прямим Cairo (той самий принцип, що
 *     menu_poll: не перемальовувати, доки контент не змінився) — рядок
 *     несе ЖИВЕ число, тож "готового" варіанта в шаблоні нема;
 *   - смуга прогресу — щокадру, напряму Cairo в переюзану поверхню й ту
 *     саму GL-текстуру (glTexSubImage2D, без нового glGenTextures) —
 *     єдиний елемент, що рухається безперервно, тому єдиний, для якого
 *     "щокадру" взагалі виправдано за уроком CLAUDE.md про Chromium
 *     (нескінченна анімація дорога лише тоді, коли перемальовує багато
 *     пікселів; тут це смужка ~398×6, не вся сцена 1920×1080).
 */
#ifndef POS_NATIVE_BONUS_H
#define POS_NATIVE_BONUS_H

#include <cairo/cairo.h>
#include <stdbool.h>
#include "config.h"
#include "gl.h"
#include "menu.h"
#include "popup.h"

typedef struct {
    char drink_name[64];
    char sprite[32];       /* ключ у assets/drinks/, може бути порожнім */
    char qr_payload[128];
    char earned_at[8];     /* "09:41" — коли нарахували, для дрібного підпису */
    int coins;
    bool secret;           /* разом із монетами випав предмет — бейдж-подарунок */
    double created_at;     /* sim_t на момент появи */

    gl_texture_t chrome_tex;        /* SVG-шаблон рядка разом із QR — пече раз */
    cairo_surface_t *bar_surf;  gl_texture_t bar_tex;     /* оновлюється щокадру */
    cairo_surface_t *timer_surf; gl_texture_t timer_tex;  /* перепікається раз на секунду */
    int last_baked_sec;            /* remain-у-секундах, для якого timer_surf вже актуальний; -1 = ще ніколи */
} bonus_row_t;

typedef struct {
    bonus_row_t rows[BONUS_MAX_VISIBLE];
    int count;
    double next_emulated_at;
    bool panel_has_rows;
    cairo_surface_t *panel_surf;   gl_texture_t panel_tex;   /* SVG-шаблон рамки, окремо від render_menu() */
} bonus_state_t;

void bonus_init(bonus_state_t *b, double now, const char *assets_dir);

/* Емуляція WS. Раз на BONUS_EMULATE_PERIOD_S додає випадковий напій з
 * меню (fallback — фіксована назва, якщо меню ще не завантажилось).
 * true рівно тоді, коли рядок справді зʼявився — тоді ж заповнює *out
 * для попапу; якщо панель уже повна (BONUS_MAX_VISIBLE), подія цього разу
 * просто не приходить, як і буде з реальним WS, якщо клієнт не встигає
 * забрати попередні. */
bool bonus_tick_emulate(bonus_state_t *b, double now, const menu_t *menu, bonus_popup_t *out);

/* Подія bonus_ready із ws (ws.c): справжній бонус за справжній чек.
 * Назву й картинку бере з меню за system_code, а name використовує лише
 * як запасний варіант. items — скільки предметів випало, -1 якщо подія
 * цього не каже (ws.h). true — рядок зʼявився (панель могла бути повна). */
bool bonus_add_event(bonus_state_t *b, double now, const menu_t *menu,
                     const char *code, const char *name, int coins,
                     const char *claim_token, int items, bonus_popup_t *out);

/* Вміст для демо-показу попапу (POPUP=1, SIGUSR1, DESKTOP_FRAMES): той
 * самий попап, що й на справжній бонус, але без рядка в панелі — щоб
 * подивитись на дизайн, не засмічуючи панель вигаданими QR. */
void bonus_demo_popup(bonus_popup_t *out);

/* Прибирає прострочені рядки (remain<=0), допікає/оновлює текстури.
 * Викликати раз на кадр ДО bonus_draw(). bake_ok=false відкладає рендер
 * нового рядка (SVG + QR, на Pi 1 ~0,3 с стоячого кадру) на наступні кадри:
 * main.c не дає пекти, поки попап проявляється чи ховається, — тоді ривок
 * припадає на нерухомий попап, а не посеред анімації. Рядок без готової
 * текстури тим часом просто не малюється. */
void bonus_update(bonus_state_t *b, double now, const char *assets_dir, bool bake_ok);

void bonus_draw(bonus_state_t *b, gl_compositor_t *comp);

void bonus_destroy(bonus_state_t *b);

#endif
