/* menu.h — модель меню й опитування API. Дзеркалить app.js: той самий
 * ключ points/<point>/menu.json у публічному бакеті, той самий принцип «перемалювати
 * лише коли змінився хеш», той самий refreshSec із відповіді сервера. */
#ifndef POS_NATIVE_MENU_H
#define POS_NATIVE_MENU_H

#include <stdbool.h>
#include <time.h>
#include <signal.h>

#define MENU_MAX_DRINKS 24
#define MENU_MAX_CUPS 4
#define MENU_STR 64

typedef struct {
    char name[MENU_STR];
    char vol[MENU_STR];
    char cup[8];
    int price;
    char color[16];      /* "#rrggbb" як у JSON */
    bool foam;
    /* Ключ файлу в assets/drinks/ (без .png), напр. "cappuccino" —
     * JSON-поле "sprite". Порожній рядок, якщо в меню його ще нема
     * (старий prices.json) — card.svg тоді просто отримає биту href,
     * librsvg промовчить і не намалює картинку, решта картки лишиться. */
    char sprite[32];
    /* JSON-поле "bonus_coins" — 0, якщо відсутнє (звичайна картка).
     * >0 вмикає темний оверлей + бейдж монет у лівому верхньому куті
     * (card_bonus.svg замість card.svg, render.c) — "Американо/Капучино
     * з бонусами" в макеті. */
    int bonus_coins;
} drink_t;

/* Рекламна картка правої панелі — JSON-ключ "ad", підтягується разом із
 * рештою меню (той самий points/<point>/menu.json, той самий refreshSec
 * і хеш-порівняння: своєї окремої частоти опитування ad не потребує). */
typedef struct {
    char promo_label[MENU_STR];  /* "АКЦІЯ" */
    char head1[MENU_STR];
    char head2[MENU_STR];
    char sub[MENU_STR];          /* градієнтний рядок акції */
    char fine[MENU_STR];         /* "діє до 12:00 в п'ятницю" */
    char sprite[32];             /* герой-напій, той самий ключ, що й у drink_t */
    bool valid;                  /* false — у меню нема "ad", панель не малюється */
} ad_t;

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
    ad_t ad;
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

/* Прапорець "кидай усе і виходь" для curl усередині menu_poll.
 *
 * Без цього зупинка кіоска впиралась у CURLOPT_TIMEOUT: якщо SIGTERM
 * прилітав саме тоді, коли фоновий потік висів на повільному HTTPS,
 * pthread_join у main.c чекав до 15 секунд. Для звичайного вимкнення це
 * дрібниця, а для оновлення — рівно та пауза, коли на екрані вже нічого
 * немає (dispmanx-шар зникає разом із процесом). Тепер curl перевіряє
 * прапорець у progress-колбеку й обриває зʼєднання одразу.
 *
 * NULL — вимкнути перевірку (стан за замовчуванням). */
void menu_set_abort_flag(volatile sig_atomic_t *flag);

unsigned long menu_fnv1a(const char *data, size_t len);

#endif
