#include "menu.h"
#include "config.h"   /* бренд, період опитування — тепер константи збірки */
#include <curl/curl.h>
#include <cJSON.h>       /* вендорено в third_party/cjson/ — див. Makefile */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>      /* getpid() — суфікс тимчасового файла кешу */
#include <math.h>        /* lround — ціни округлюються до цілої гривні */

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
    /* Округлення, а не valueint (той відкидає дріб): знижена ціна — ціле
     * число гривень, і на екрані має бути саме воно (власник, 27.09.2026). */
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "price")) && cJSON_IsNumber(j))
        d->price = (int)lround(j->valuedouble);
    if ((j = cJSON_GetObjectItemCaseSensitive(item, "price_full")) && cJSON_IsNumber(j))
        d->price_full = (int)lround(j->valuedouble);
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

/* Шлях до кешу меню: поруч зі станом стеку. Порожньо (десктоп, тести) —
 * кеш вимкнено, поведінка та сама, що була. */
static bool cache_path(char *buf, size_t n) {
    const char *dir = getenv("EXTROVERT_STATE");
    if (!dir || !dir[0]) return false;
    snprintf(buf, n, "%s/menu-cache.json", dir);
    return true;
}

static bool parse_body(const char *data, size_t len, menu_t *out);

/* Остання вдала менюшка на диску. Читаємо її, коли мережі немає, — інакше
 * кіоск після холодного старту без інтернету не має ЧОГО малювати: шар
 * лишається прозорим, і на екрані висить запасна картинка від fbi
 * (знайдено власником 25.09.2026, коли він увімкнув точку без кабелю).
 * Ціни з кешу можуть бути вчорашні — рівно такі самі, як на тій картинці,
 * тільки кіоск при цьому живий і малює свій кадр. */
bool menu_load_cache(menu_t *out) {
    char path[1024];
    if (!cache_path(path, sizeof(path))) return false;
    FILE *fp = fopen(path, "rb");
    if (!fp) return false;
    struct buf b = {0};
    char chunk[4096];
    size_t got;
    while ((got = fread(chunk, 1, sizeof(chunk), fp)) > 0)
        if (write_cb(chunk, 1, got, &b) != got) break;
    fclose(fp);
    bool ok = b.len && parse_body(b.data, b.len, out);
    free(b.data);
    fprintf(stderr, "menu: кеш %s — %s\n", path, ok ? "прочитано" : "не придатний");
    return ok;
}

/* Пишемо через тимчасовий файл і rename: живлення на точці просідає, і
 * напівзаписаний кеш пережив би перезавантаження, а меню — ні. */
static void cache_store(const char *data, size_t len) {
    char path[1024], tmp[1100];
    if (!cache_path(path, sizeof(path))) return;
    snprintf(tmp, sizeof(tmp), "%s.%d.tmp", path, (int)getpid());
    FILE *fp = fopen(tmp, "wb");
    if (!fp) return;
    bool ok = fwrite(data, 1, len, fp) == len;
    if (fclose(fp) != 0 || !ok || rename(tmp, path) != 0) remove(tmp);
}

/* Один хендл на весь процес, а не новий на кожне опитування.
 *
 * Чому це важливо саме тут. Новий easy-хендл означає нове зʼєднання: DNS-
 * запит, SYN, TLS-рукостискання. На точці kyiv-01 роутер губить саме НОВІ
 * зʼєднання — заміряно 26.09.2026 прямо з малини: звичайний запит 0,7 с, а
 * час від часу DNS зависає рівно на 5,5 с (таймаут resolv.conf плюс
 * повтор) або connect на 15,6 с (ретрансміти загубленого SYN: 1+2+4+8).
 * При CURLOPT_TIMEOUT=15 друге означає гарантовану помилку — і в логу було
 * 51 «menu_poll: http помилка» на 100 рядків.
 *
 * Хендл, що живе далі, тримає з'єднання відкритим (keep-alive) і кешує
 * DNS, тож більшість опитувань не створює нічого нового й роутеру нема що
 * губити. Таймаут лишаємо 15 с: стартове опитування (main.c) синхронне, і
 * довший таймаут відкладав би перший кадр на поганій мережі.
 *
 * Потокобезпечність: easy-хендл не можна ділити між потоками ОДНОЧАСНО.
 * Тут цього й немає — main.c кличе menu_poll() один раз до pthread_create,
 * а далі лише потік опитування. */
static CURL *poll_curl = NULL;
static bool last_poll_ok = false;
static CURL *ack_curl = NULL;   /* той самий потік меню, окреме зʼєднання — з api, не з бакетом */

bool menu_last_poll_ok(void) { return last_poll_ok; }

void menu_poll_close(void) {
    if (poll_curl) { curl_easy_cleanup(poll_curl); poll_curl = NULL; }
    if (ack_curl) { curl_easy_cleanup(ack_curl); ack_curl = NULL; }
}

static size_t discard_cb(char *ptr, size_t size, size_t nmemb, void *userdata) {
    (void)ptr; (void)userdata;
    return size * nmemb;
}

bool menu_ack(const char *url, const char *token, long long deployment_id) {
    if (!url || !url[0] || !token || !token[0] || deployment_id <= 0) return false;
    if (!ack_curl) {
        ack_curl = curl_easy_init();
        if (!ack_curl) return false;
        curl_easy_setopt(ack_curl, CURLOPT_TIMEOUT, 10L);
        curl_easy_setopt(ack_curl, CURLOPT_WRITEFUNCTION, discard_cb);
        curl_easy_setopt(ack_curl, CURLOPT_USERAGENT, "raspberry/kiosk/0.1");
        curl_easy_setopt(ack_curl, CURLOPT_NOPROGRESS, 0L);
        curl_easy_setopt(ack_curl, CURLOPT_XFERINFOFUNCTION, xfer_cb);
    }
    char auth[2200], body[64];
    snprintf(auth, sizeof(auth), "authorization: Bearer %s", token);
    snprintf(body, sizeof(body), "{\"deployment_id\":%lld}", deployment_id);
    struct curl_slist *h = NULL;
    h = curl_slist_append(h, auth);
    h = curl_slist_append(h, "content-type: application/json");
    curl_easy_setopt(ack_curl, CURLOPT_URL, url);
    curl_easy_setopt(ack_curl, CURLOPT_HTTPHEADER, h);
    curl_easy_setopt(ack_curl, CURLOPT_POSTFIELDS, body);
    CURLcode rc = curl_easy_perform(ack_curl);
    long code = 0;
    curl_easy_getinfo(ack_curl, CURLINFO_RESPONSE_CODE, &code);
    curl_easy_setopt(ack_curl, CURLOPT_HTTPHEADER, NULL);
    curl_slist_free_all(h);
    fprintf(stderr, "menu: деплой %lld підтверджено — %s (код %ld)\n",
            deployment_id, rc == CURLE_OK ? "ok" : curl_easy_strerror(rc), code);
    return rc == CURLE_OK && code >= 200 && code < 300;
}

bool menu_expire_discount(menu_t *m, long long now) {
    if (!m->discount || now < m->discount_until) return false;
    for (int i = 0; i < m->drink_count; i++) {
        drink_t *d = &m->drinks[i];
        if (d->price_full > 0) { d->price = d->price_full; d->price_full = 0; }
    }
    m->discount = false;
    m->discount_uah = 0;
    m->discount_until = 0;
    return true;
}

bool menu_poll(const char *url, menu_t *out) {
    struct buf b = {0};
    if (!poll_curl) {
        poll_curl = curl_easy_init();
        if (!poll_curl) return false;
        curl_easy_setopt(poll_curl, CURLOPT_WRITEFUNCTION, write_cb);
        curl_easy_setopt(poll_curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(poll_curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(poll_curl, CURLOPT_USERAGENT, "raspberry/kiosk/0.1");
        curl_easy_setopt(poll_curl, CURLOPT_NOPROGRESS, 0L);
        curl_easy_setopt(poll_curl, CURLOPT_XFERINFOFUNCTION, xfer_cb);
        /* Щоб NAT роутера не викинув простояле зʼєднання між опитуваннями. */
        curl_easy_setopt(poll_curl, CURLOPT_TCP_KEEPALIVE, 1L);
        /* Типові 60 с менші за період опитування, тобто DNS питався б щоразу
         * наново. Година — адреси Cloudflare стабільні, а при обриві libcurl
         * однаково перепитає. */
        curl_easy_setopt(poll_curl, CURLOPT_DNS_CACHE_TIMEOUT, 3600L);
        /* Той самий сенс, що і "t="+Date.now() в getJSON() з app.js — кеш
         * проксі не повинен віддавати старе тіло, з якого й береться хеш. */
        curl_easy_setopt(poll_curl, CURLOPT_HTTPHEADER, NULL);
    }
    CURL *c = poll_curl;
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &b);

    CURLcode rc = curl_easy_perform(c);
    long http_code = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &http_code);

    last_poll_ok = !(rc != CURLE_OK || http_code < 200 || http_code >= 300 || b.len == 0);
    if (!last_poll_ok) {
        fprintf(stderr, "menu_poll: http помилка (%s, код %ld)\n",
                curl_easy_strerror(rc), http_code);
        free(b.data);
        return false;
    }

    /* Кладемо в кеш кожне вдале тіло, навіть якщо воно не змінилось: файл
     * міг зникнути разом зі станом, а коштує це один запис на хвилину. */
    cache_store(b.data, b.len);

    bool changed = parse_body(b.data, b.len, out);
    free(b.data);
    return changed;
}

static bool parse_body(const char *data, size_t len, menu_t *out) {
    unsigned long h = menu_fnv1a(data, len);
    if (out->valid && h == out->hash) return false;   /* без змін — як lastHash в app.js */

    cJSON *root = cJSON_ParseWithLength(data, len);
    if (!root) {
        fprintf(stderr, "menu: битий JSON\n");
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
    cJSON *dep = cJSON_GetObjectItemCaseSensitive(root, "deployment");
    if (cJSON_IsNumber(dep) && dep->valuedouble > 0) next.deployment_id = (long long)dep->valuedouble;

    cJSON *disc = cJSON_GetObjectItemCaseSensitive(root, "discount");
    if (disc && cJSON_IsObject(disc)) {
        cJSON *u = cJSON_GetObjectItemCaseSensitive(disc, "uah");
        cJSON *t = cJSON_GetObjectItemCaseSensitive(disc, "until_ts");
        if (cJSON_IsNumber(t) && t->valuedouble > 0) {
            next.discount = true;
            next.discount_uah = cJSON_IsNumber(u) ? (int)lround(u->valuedouble) : 0;
            next.discount_until = (long long)t->valuedouble;
        }
    }

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
