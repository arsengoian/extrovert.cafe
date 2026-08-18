#include "menu.h"
#include <curl/curl.h>
#include <cjson/cJSON.h>
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
    curl_easy_setopt(c, CURLOPT_USERAGENT, "pos-native/0.1");
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
    cJSON *brand = cJSON_GetObjectItemCaseSensitive(root, "brand");
    if (brand) {
        cJSON *j;
        if ((j = cJSON_GetObjectItemCaseSensitive(brand, "name")) && cJSON_IsString(j))
            snprintf(next.brand_name, MENU_STR, "%s", j->valuestring);
        if ((j = cJSON_GetObjectItemCaseSensitive(brand, "suffix")) && cJSON_IsString(j))
            snprintf(next.brand_suffix, MENU_STR, "%s", j->valuestring);
    }
    cJSON *rs = cJSON_GetObjectItemCaseSensitive(root, "refreshSec");
    next.refresh_sec = (rs && cJSON_IsNumber(rs)) ? rs->valueint : 60;

    cJSON *drinks = cJSON_GetObjectItemCaseSensitive(root, "drinks");
    if (drinks && cJSON_IsArray(drinks)) {
        cJSON *it;
        cJSON_ArrayForEach(it, drinks) {
            if (next.drink_count >= MENU_MAX_DRINKS) break;
            parse_drink(it, &next.drinks[next.drink_count++]);
        }
    }
    cJSON_Delete(root);

    next.hash = h;
    next.valid = true;
    *out = next;
    return true;
}
