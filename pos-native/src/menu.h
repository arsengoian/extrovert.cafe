/* menu.h — модель меню й опитування API. Дзеркалить app.js: той самий
 * ендпойнт /api/v1/points/<point>/menu, той самий принцип «перемалювати
 * лише коли змінився хеш», той самий refreshSec із відповіді сервера. */
#ifndef POS_NATIVE_MENU_H
#define POS_NATIVE_MENU_H

#include <stdbool.h>
#include <time.h>

#define MENU_MAX_DRINKS 24
#define MENU_MAX_CUPS 4
#define MENU_MAX_STEPS 6
#define MENU_MAX_PAYMENTS 8
#define MENU_STR 64

typedef struct {
    char name[MENU_STR];
    char vol[MENU_STR];
    char cup[8];
    int price;
    char color[16];      /* "#rrggbb" як у JSON */
    bool foam;
} drink_t;

/* d.cups[<key>] — розмір стакана: підказка, який стакан узяти ДО вибору
 * напою (app.js:138-142, .cupTag/.cupTag.org у style.css:35-36). */
typedef struct {
    char key[8];          /* "S", "M", ... — збігається з drink_t.cup */
    char short_label[8];  /* те, що йде в бейдж */
    bool organizer;       /* where=="organizer" → колір .org (помаранчевий) */
} cup_tier_t;

typedef struct {
    char brand_name[MENU_STR];
    char brand_suffix[MENU_STR];
    drink_t drinks[MENU_MAX_DRINKS];
    int drink_count;
    cup_tier_t cups[MENU_MAX_CUPS];
    int cup_count;
    char steps[MENU_MAX_STEPS][MENU_STR];
    int step_count;
    char payments[MENU_MAX_PAYMENTS][MENU_STR];
    int payment_count;
    char cash_note[MENU_STR];
    char qr_line1[MENU_STR];
    char qr_line2[MENU_STR];
    char qr_line3[MENU_STR];
    int refresh_sec;
    unsigned long hash;      /* FNV-1a по сирому тілу відповіді — як lastHash у app.js */
    bool valid;
} menu_t;

/* Пошук тарифу стакана за ключем із drink_t.cup — dispenser/organizer +
 * короткий підпис для бейджа. NULL, якщо в меню такого ключа нема. */
const cup_tier_t *menu_find_cup(const menu_t *m, const char *key);

/* Опитує URL один раз. Повертає true й заповнює *out, якщо тіло відповіді
 * має новий хеш (тобто змінилось). Якщо хеш той самий — повертає false
 * і *out не займає CPU на перепарс, так само як apply(d, cache) в app.js
 * порівнює JSON.stringify(d) з lastHash перед render(). */
bool menu_poll(const char *url, menu_t *out);

unsigned long menu_fnv1a(const char *data, size_t len);

#endif
