/* menu.h — модель меню й опитування API. Дзеркалить app.js: той самий
 * ендпойнт /api/v1/points/<point>/menu, той самий принцип «перемалювати
 * лише коли змінився хеш», той самий refreshSec із відповіді сервера. */
#ifndef POS_NATIVE_MENU_H
#define POS_NATIVE_MENU_H

#include <stdbool.h>
#include <time.h>

#define MENU_MAX_DRINKS 24
#define MENU_STR 64

typedef struct {
    char name[MENU_STR];
    char vol[MENU_STR];
    char cup[8];
    int price;
    char color[16];      /* "#rrggbb" як у JSON */
    bool foam;
} drink_t;

typedef struct {
    char brand_name[MENU_STR];
    char brand_suffix[MENU_STR];
    drink_t drinks[MENU_MAX_DRINKS];
    int drink_count;
    int refresh_sec;
    unsigned long hash;      /* FNV-1a по сирому тілу відповіді — як lastHash у app.js */
    bool valid;
} menu_t;

/* Опитує URL один раз. Повертає true й заповнює *out, якщо тіло відповіді
 * має новий хеш (тобто змінилось). Якщо хеш той самий — повертає false
 * і *out не займає CPU на перепарс, так само як apply(d, cache) в app.js
 * порівнює JSON.stringify(d) з lastHash перед render(). */
bool menu_poll(const char *url, menu_t *out);

unsigned long menu_fnv1a(const char *data, size_t len);

#endif
