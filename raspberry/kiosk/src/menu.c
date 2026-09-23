#include "menu.h"
#include "config.h"   /* бренд, період опитування — тепер константи збірки */
#include <curl/curl.h>
#include <cJSON.h>       /* вендорено в third_party/cjson/ — див. Makefile */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* FNV-1a — той самий клас перевірки, що JSON.stringify(d)===lastHash
 * в app.js, тільки без переалокації рядка щоразу. */
unsigned long menu_fnv1a(const char *data, size_t len) {
    unsigned long h = 0x811c9dc5UL;
    for (size_t i = 0; i < len; i++) {
        h ^= (unsigned char)data[i];
        h *= 0x01000193UL;
    }
    return h;
}

struct buf { char *data; size_t len, cap; };

static volatile sig_atomic_t *g_abort_flag = NULL;

void menu_set_abort_flag(volatile sig_atomic_t *flag) { g_abort_flag = flag; }

/* Ненульове повернення = curl негайно обриває передачу (CURLE_ABORTED_BY_CALLBACK).
 * Колбек викликається і під час очікування даних, не тільки на кожному
 * прийнятому байті, — тому працює навіть на зʼєднанні, що мовчить. */
static int xfer_cb(void *p, curl_off_t dltotal, curl_off_t dlnow,
                   curl_off_t ultotal, curl_off_t ulnow) {
    (void)p; (void)dltotal; (void)dlnow; (void)ultotal; (void)ulnow;
    return (g_abort_flag && *g_abort_flag) ? 1 : 0;
}

static size_t write_cb(char *ptr, size_t size, size_t nmemb, void *userdata) {
    struct buf *b = (struct buf *)userdata;
    size_t add = size * nmemb;
    if (b->len + add + 1 > b->cap) {
        size_t ncap = (b->cap ? b->cap * 2 : 4096);
        while (ncap < b->len + add + 1) ncap *= 2;
        char *nd = realloc(b->data, ncap);
        if (!nd) return 0;
        b->data = nd; b->cap = ncap;
    }
    memcpy(b->data + b->len, ptr, add);
    b->len += add;
    b->data[b->len] = 0;
    return add;
}

static void parse_drink(cJSON *item, drink_t *d) {
    memset(d, 0, sizeof(*d));
    cJSON *j;
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "name")) && cJSON_IsString(j))
        snprintf(d->name, MENU_STR, "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "vol")) && cJSON_IsString(j))
        snprintf(d->vol, MENU_STR, "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "cup")) && cJSON_IsString(j))
        snprintf(d->cup, sizeof(d->cup), "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "price")) && cJSON_IsNumber(j))
        d->price = j->valueint;
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "color")) && cJSON_IsString(j))
        snprintf(d->color, sizeof(d->color), "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "foam")) && cJSON_IsBool(j))
        d->foam = cJSON_IsTrue(j);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "sprite")) && cJSON_IsString(j))
        snprintf(d->sprite, sizeof(d->sprite), "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "system_code")) && cJSON_IsString(j))
        snprintf(d->system_code, sizeof(d->system_code), "%s", j->valuestring);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "is_bonus")) && cJSON_IsBool(j))
        d->is_bonus = cJSON_IsTrue(j);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "coins")) && cJSON_IsNumber(j))
        d->coins = j->valueint;
}

/* Лінійка стаканів. Вона фізична: S — паперовий із органайзера (його
 * ставлять рукою), M і L — із роздавача автомата. Заміри, ескізи й чому
 * саме так — docs/display-hardware.md; кіоску з усього цього потрібні лише
 * підпис бейджа й те, звідки стакан брати.
 *
 * Тут, а не в меню: стакани не змінювались жодного разу й не залежать від
 * точки, а нова лінійка — це однаково новий реліз кіоска (інші розміри
 * малюються інакше), не рядок у JSON. */
static const cup_tier_t CUPS[] = {
    { "S", "S", true  },
    { "M", "M", false },
    { "L", "L", false },
};

void menu_fill_cups(menu_t *m) {
    m->cup_count = 0;
    for (size_t i = 0; i < sizeof(CUPS) / sizeof(CUPS[0]) && m->cup_count < MENU_MAX_CUPS; i++)
        m->cups[m->cup_count++] = CUPS[i];
}

const cup_tier_t *menu_find_cup(const menu_t *m, const char *key) {
    if (!key) return NULL;
    for (int i = 0; i < m->cup_count; i++)
        if (strcmp(m->cups[i].key, key) == 0) return &m->cups[i];
    return NULL;
}

bool menu_poll(const char *url, menu_t *out) {
    struct buf b = {0};
    CURL *c = curl_easy_init();
    if (!c) return false;
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &b);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, 15L);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, "raspberry/kiosk/0.1");
    curl_easy_setopt(c, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(c, CURLOPT_XFERINFOFUNCTION, xfer_cb);
    /* Той самий сенс, що і "t="+Date.now() в getJSON() з app.js — кеш проксі
     * не повинен віддавати старе тіло, з якого й береться хеш. */
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, NULL);

    CURLcode rc = curl_easy_perform(c);
    long http_code = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &http_code);
    curl_easy_cleanup(c);

    if (rc != CURLE_OK || http_code < 200 || http_code >= 300 || b.len == 0) {
        fprintf(stderr, "menu_poll: http помилка (%s, код %ld)\n",
                curl_easy_strerror(rc), http_code);
        free(b.data);
        return false;
    }

    unsigned long h = menu_fnv1a(b.data, b.len);
    if (out->valid && h == out->hash) {
        free(b.data);
        return false;               /* без змін — так само як lastHash в app.js */
    }

    cJSON *root = cJSON_ParseWithLength(b.data, b.len);
    free(b.data);
    if (!root) {
        fprintf(stderr, "menu_poll: битий JSON\n");
        return false;
    }

    menu_t next = {0};

    /* Бренд, розміри стаканів і період опитування більше не приходять у
     * меню (21.09.2026). Вони не змінюються від точки до точки й не
     * змінювались жодного разу відтоді, як зʼявились, — а кожне зайве поле
     * в menu.json це ще одне місце, де прод і кіоск можуть розійтись.
     * Тепер це константи збірки (config.h), а по мережі їде тільки те, що
     * справді міняють: напої й акція. */
    snprintf(next.brand_name, MENU_STR, "%s", BRAND_NAME);
    snprintf(next.brand_suffix, MENU_STR, "%s", BRAND_SUFFIX);
    next.refresh_sec = MENU_REFRESH_SEC;
    menu_fill_cups(&next);

    cJSON *drinks = cJSON_GetObjectItemCaseSensitive(root, "drinks");
    if (drinks && cJSON_IsArray(drinks)) {
        cJSON *it;
        cJSON_ArrayForEach(it, drinks) {
            if (next.drink_count >= MENU_MAX_DRINKS) break;
            parse_drink(it, &next.drinks[next.drink_count++]);
        }
    }


    cJSON *j;
    cJSON *ad = cJSON_GetObjectItemCaseSensitive(root, "ad");
    if (ad) {
        next.ad.valid = true;
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "promo_label")) && cJSON_IsString(j))
            snprintf(next.ad.promo_label, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "head1")) && cJSON_IsString(j))
            snprintf(next.ad.head1, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "head2")) && cJSON_IsString(j))
            snprintf(next.ad.head2, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "sub")) && cJSON_IsString(j))
            snprintf(next.ad.sub, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "fine")) && cJSON_IsString(j))
            snprintf(next.ad.fine, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(ad, "sprite")) && cJSON_IsString(j))
            snprintf(next.ad.sprite, sizeof(next.ad.sprite), "%s", j->valuestring);
    }

    cJSON_Delete(root);

    next.hash = h;
    next.valid = true;
    *out = next;
    return true;
}
