/* ws.c — реалізація клієнта вебсокета (див. ws.h, чому руками, а не lws).
 *
 * Розкладка файлу: дрібні помічники (base64, SHA-1, час) → транспорт поверх
 * curl → кадри RFC 6455 → рукостискання → життя одного зʼєднання → потік із
 * перепідключенням.
 */
#include "ws.h"

#include <curl/curl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>
#include <errno.h>
#include <sys/select.h>

#include "cJSON.h"
#include "config.h"

#define WS_QUEUE_CAP 16        /* подій, що чекають на головний потік */
#define WS_SEEN_CAP 32         /* останні id для відкидання повторів */
#define WS_RX_CAP (32 * 1024)
#define WS_GUID "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

struct ws_client {
    char url[256];
    char token[2048];

    /* розібраний url */
    bool tls;
    char host[160];
    char port[8];
    char path[128];

    pthread_t thread;
    pthread_mutex_t lock;
    bool stop;
    bool online;

    ws_event_t queue[WS_QUEUE_CAP];
    int q_head, q_count;

    long long seen[WS_SEEN_CAP];
    int seen_n, seen_pos;
};

/* ─── дрібниці ──────────────────────────────────────────────────────── */

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

static void sleep_s(double s) {
    struct timespec ts = { (time_t)s, (long)((s - (double)(time_t)s) * 1e9) };
    nanosleep(&ts, NULL);
}

static void random_bytes(unsigned char *out, size_t n) {
    FILE *f = fopen("/dev/urandom", "rb");
    if (f && fread(out, 1, n, f) == n) { fclose(f); return; }
    if (f) fclose(f);
    /* Без urandom маска кадру лишається маскою: вона не про секретність, а
     * про проксі, які інакше можуть переплутати кадр із HTTP-запитом. */
    for (size_t i = 0; i < n; i++) out[i] = (unsigned char)(rand() & 0xff);
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void base64(const unsigned char *in, size_t n, char *out) {
    size_t i = 0, o = 0;
    for (; i + 2 < n; i += 3) {
        unsigned v = ((unsigned)in[i] << 16) | ((unsigned)in[i + 1] << 8) | in[i + 2];
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];  out[o++] = B64[v & 63];
    }
    if (i < n) {
        unsigned v = (unsigned)in[i] << 16;
        bool two = (i + 1 < n);
        if (two) v |= (unsigned)in[i + 1] << 8;
        out[o++] = B64[(v >> 18) & 63];
        out[o++] = B64[(v >> 12) & 63];
        out[o++] = two ? B64[(v >> 6) & 63] : '=';
        out[o++] = '=';
    }
    out[o] = '\0';
}

/* SHA-1 потрібен рівно для одного: перевірити Sec-WebSocket-Accept, тобто
 * що відповів справді вебсокет-сервер, а не проксі з власною думкою.
 * Тягнути заради цього OpenSSL у залежності кіоска — задорого. */
typedef struct { unsigned h[5]; unsigned char buf[64]; size_t len; unsigned long long total; } sha1_t;

static unsigned rol(unsigned v, int s) { return (v << s) | (v >> (32 - s)); }

static void sha1_block(sha1_t *s, const unsigned char *p) {
    unsigned w[80];
    for (int i = 0; i < 16; i++)
        w[i] = ((unsigned)p[i * 4] << 24) | ((unsigned)p[i * 4 + 1] << 16) |
               ((unsigned)p[i * 4 + 2] << 8) | p[i * 4 + 3];
    for (int i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    unsigned a = s->h[0], b = s->h[1], c = s->h[2], d = s->h[3], e = s->h[4];
    for (int i = 0; i < 80; i++) {
        unsigned f, k;
        if (i < 20)      { f = (b & c) | (~b & d);            k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d;                     k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d);   k = 0x8F1BBCDC; }
        else             { f = b ^ c ^ d;                     k = 0xCA62C1D6; }
        unsigned t = rol(a, 5) + f + e + k + w[i];
        e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    s->h[0] += a; s->h[1] += b; s->h[2] += c; s->h[3] += d; s->h[4] += e;
}

static void sha1(const unsigned char *data, size_t n, unsigned char out[20]) {
    sha1_t s = { { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 }, { 0 }, 0, 0 };
    size_t i = 0;
    for (; i + 64 <= n; i += 64) sha1_block(&s, data + i);
    size_t rest = n - i;
    unsigned char tail[128] = { 0 };
    memcpy(tail, data + i, rest);
    tail[rest] = 0x80;
    size_t total_len = (rest + 1 <= 56) ? 64 : 128;
    unsigned long long bits = (unsigned long long)n * 8;
    for (int b = 0; b < 8; b++) tail[total_len - 1 - b] = (unsigned char)(bits >> (8 * b));
    sha1_block(&s, tail);
    if (total_len == 128) sha1_block(&s, tail + 64);
    for (int j = 0; j < 5; j++) {
        out[j * 4]     = (unsigned char)(s.h[j] >> 24);
        out[j * 4 + 1] = (unsigned char)(s.h[j] >> 16);
        out[j * 4 + 2] = (unsigned char)(s.h[j] >> 8);
        out[j * 4 + 3] = (unsigned char)(s.h[j]);
    }
}

/* ─── транспорт: одне зʼєднання поверх curl ─────────────────────────── */

typedef struct {
    CURL *curl;
    curl_socket_t sock;
    unsigned char buf[WS_RX_CAP];
    size_t len;
    double last_rx;
} conn_t;

static bool wait_socket(curl_socket_t sock, bool write, double timeout_s) {
    fd_set set;
    FD_ZERO(&set);
    FD_SET(sock, &set);
    struct timeval tv = { (long)timeout_s, (long)((timeout_s - (long)timeout_s) * 1e6) };
    int rc = select((int)sock + 1, write ? NULL : &set, write ? &set : NULL, NULL, &tv);
    return rc > 0;
}

static bool conn_send(conn_t *c, const unsigned char *data, size_t n) {
    size_t sent_total = 0;
    double deadline = now_s() + 10.0;
    while (sent_total < n) {
        size_t sent = 0;
        CURLcode rc = curl_easy_send(c->curl, data + sent_total, n - sent_total, &sent);
        if (rc == CURLE_OK) { sent_total += sent; continue; }
        if (rc != CURLE_AGAIN) return false;
        if (now_s() > deadline) return false;
        wait_socket(c->sock, true, 1.0);
    }
    return true;
}

/* Дочитує хоч якісь байти. false = зʼєднання померло; таймаут — не смерть,
 * просто зараз нічого нема. */
static bool conn_fill(conn_t *c, double timeout_s, bool *timed_out) {
    *timed_out = false;
    if (c->len == sizeof(c->buf)) return false;     /* кадр більший за буфер — нам таких не шлють */

    size_t got = 0;
    CURLcode rc = curl_easy_recv(c->curl, c->buf + c->len, sizeof(c->buf) - c->len, &got);
    if (rc == CURLE_OK) {
        if (got == 0) return false;                 /* сервер закрив */
        c->len += got;
        c->last_rx = now_s();
        return true;
    }
    if (rc != CURLE_AGAIN) return false;

    /* Чекаємо на сокеті. Під TLS частина даних може вже лежати розшифрованою
     * всередині curl, тому після кожного вдалого читання ми ще раз пробуємо
     * recv і лише потім повертаємось сюди. */
    if (!wait_socket(c->sock, false, timeout_s)) { *timed_out = true; return true; }
    rc = curl_easy_recv(c->curl, c->buf + c->len, sizeof(c->buf) - c->len, &got);
    if (rc == CURLE_AGAIN) { *timed_out = true; return true; }
    if (rc != CURLE_OK || got == 0) return false;
    c->len += got;
    c->last_rx = now_s();
    return true;
}

static void conn_drop(conn_t *c, size_t n) {
    if (n >= c->len) { c->len = 0; return; }
    memmove(c->buf, c->buf + n, c->len - n);
    c->len -= n;
}

/* ─── кадри ─────────────────────────────────────────────────────────── */

#define OP_TEXT 0x1
#define OP_CLOSE 0x8
#define OP_PING 0x9
#define OP_PONG 0xA

static bool frame_send(conn_t *c, int opcode, const unsigned char *payload, size_t n) {
    unsigned char head[14];
    size_t h = 0;
    head[h++] = (unsigned char)(0x80 | opcode);       /* FIN + opcode */
    /* Клієнт зобовʼязаний маскувати — сервер розірве зʼєднання інакше. */
    if (n < 126) head[h++] = (unsigned char)(0x80 | n);
    else if (n < 65536) {
        head[h++] = 0x80 | 126;
        head[h++] = (unsigned char)(n >> 8); head[h++] = (unsigned char)n;
    } else {
        head[h++] = 0x80 | 127;
        for (int i = 7; i >= 0; i--) head[h++] = (unsigned char)((unsigned long long)n >> (8 * i));
    }
    unsigned char mask[4];
    random_bytes(mask, 4);
    memcpy(head + h, mask, 4); h += 4;
    if (!conn_send(c, head, h)) return false;
    if (n == 0) return true;

    unsigned char chunk[1024];
    for (size_t i = 0; i < n; ) {
        size_t take = n - i < sizeof(chunk) ? n - i : sizeof(chunk);
        for (size_t j = 0; j < take; j++) chunk[j] = payload[i + j] ^ mask[(i + j) & 3];
        if (!conn_send(c, chunk, take)) return false;
        i += take;
    }
    return true;
}

/* Розбирає один кадр із буфера. need_more = кадр ще не дочитано. */
typedef struct { int opcode; bool fin; const unsigned char *payload; size_t len; size_t total; } frame_t;

static bool frame_parse(conn_t *c, frame_t *f, bool *need_more) {
    *need_more = true;
    if (c->len < 2) return true;

    unsigned char b0 = c->buf[0], b1 = c->buf[1];
    f->fin = (b0 & 0x80) != 0;
    f->opcode = b0 & 0x0f;
    bool masked = (b1 & 0x80) != 0;
    size_t n = b1 & 0x7f;
    size_t h = 2;

    if (n == 126) {
        if (c->len < 4) return true;
        n = ((size_t)c->buf[2] << 8) | c->buf[3];
        h = 4;
    } else if (n == 127) {
        if (c->len < 10) return true;
        n = 0;
        for (int i = 0; i < 8; i++) n = (n << 8) | c->buf[2 + i];
        h = 10;
    }
    /* Сервер маскувати не має права (RFC 6455 §5.1). Якщо маскує — це не
     * наш сервер або щось посередині ламає потік; розбирати далі немає сенсу. */
    if (masked) return false;
    if (n > sizeof(c->buf) - 64) return false;   /* завелике: рвемо зʼєднання */
    if (c->len < h + n) return true;

    f->payload = c->buf + h;
    f->len = n;
    f->total = h + n;
    *need_more = false;
    return true;
}

/* ─── рукостискання ─────────────────────────────────────────────────── */

static bool handshake(conn_t *c, ws_client_t *w) {
    unsigned char nonce[16];
    random_bytes(nonce, sizeof(nonce));
    char key[32];
    base64(nonce, sizeof(nonce), key);

    char req[2600];
    int n = snprintf(req, sizeof(req),
        "GET %s HTTP/1.1\r\n"
        "Host: %s\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        /* Токен їде підпротоколом, як і в застосунку: заголовків у
         * браузерного WebSocket немає, тож сервер навчений читати саме це,
         * і кіоск має говорити з ним так само (docs/services.md §3). */
        "Sec-WebSocket-Protocol: extrovert.v1, jwt.%s\r\n"
        "\r\n",
        w->path, w->host, key, w->token);
    if (n <= 0 || (size_t)n >= sizeof(req)) {
        fprintf(stderr, "ws: токен не влазить у запит\n");
        return false;
    }
    if (!conn_send(c, (const unsigned char *)req, (size_t)n)) return false;

    /* Читаємо до порожнього рядка. Заголовки малі, в буфер влазять. */
    double deadline = now_s() + 10.0;
    char *end = NULL;
    while (now_s() < deadline) {
        if (c->len) {
            c->buf[c->len < sizeof(c->buf) ? c->len : sizeof(c->buf) - 1] = '\0';
            end = strstr((char *)c->buf, "\r\n\r\n");
            if (end) break;
        }
        bool timed_out = false;
        if (!conn_fill(c, 1.0, &timed_out)) return false;
    }
    if (!end) { fprintf(stderr, "ws: сервер не відповів на рукостискання\n"); return false; }

    size_t head_len = (size_t)(end - (char *)c->buf) + 4;
    if (!strstr((char *)c->buf, " 101 ")) {
        char first[120] = { 0 };
        size_t take = head_len < sizeof(first) - 1 ? head_len : sizeof(first) - 1;
        memcpy(first, c->buf, take);
        char *nl = strchr(first, '\r'); if (nl) *nl = '\0';
        fprintf(stderr, "ws: замість 101 прийшло «%s»\n", first);
        return false;
    }

    /* Перевіряємо Accept: інакше «101» міг би віддати будь-хто. */
    /* 24 байти base64 від 16-байтового nonce + 36 GUID; запас, щоб компілятор
     * не мусив доводити це сам. */
    char expect_src[96];
    snprintf(expect_src, sizeof(expect_src), "%s" WS_GUID, key);
    unsigned char digest[20];
    sha1((const unsigned char *)expect_src, strlen(expect_src), digest);
    char expect[32];
    base64(digest, sizeof(digest), expect);

    const char *got = NULL;
    for (char *p = (char *)c->buf; p && p < (char *)c->buf + head_len; p = strchr(p, '\n')) {
        if (*p == '\n') p++;
        if (strncasecmp(p, "Sec-WebSocket-Accept:", 21) == 0) {
            got = p + 21;
            while (*got == ' ') got++;
            break;
        }
    }
    if (!got || strncmp(got, expect, strlen(expect)) != 0) {
        fprintf(stderr, "ws: Sec-WebSocket-Accept не збігся — це не наш сервер\n");
        return false;
    }

    conn_drop(c, head_len);
    return true;
}

/* ─── події ─────────────────────────────────────────────────────────── */

static bool already_seen(ws_client_t *w, long long id) {
    for (int i = 0; i < w->seen_n; i++) if (w->seen[i] == id) return true;
    w->seen[w->seen_pos] = id;
    w->seen_pos = (w->seen_pos + 1) % WS_SEEN_CAP;
    if (w->seen_n < WS_SEEN_CAP) w->seen_n++;
    return false;
}

static void push_event(ws_client_t *w, const ws_event_t *e) {
    pthread_mutex_lock(&w->lock);
    if (w->q_count == WS_QUEUE_CAP) {
        /* Черга повна — головний потік не забирає. Викидаємо найстаріше:
         * свіжий бонус потрібніший за той, що вже майже протух. */
        w->q_head = (w->q_head + 1) % WS_QUEUE_CAP;
        w->q_count--;
    }
    w->queue[(w->q_head + w->q_count) % WS_QUEUE_CAP] = *e;
    w->q_count++;
    pthread_mutex_unlock(&w->lock);
}

static void handle_text(ws_client_t *w, const unsigned char *payload, size_t len) {
    char *text = malloc(len + 1);
    if (!text) return;
    memcpy(text, payload, len);
    text[len] = '\0';

    cJSON *root = cJSON_Parse(text);
    free(text);
    if (!root) { fprintf(stderr, "ws: битий JSON у події\n"); return; }

    const cJSON *ev = cJSON_GetObjectItemCaseSensitive(root, "event");
    if (cJSON_IsString(ev) && strcmp(ev->valuestring, "hello") == 0) {
        const cJSON *ch = cJSON_GetObjectItemCaseSensitive(root, "channel");
        fprintf(stderr, "ws: підписані на %s\n", cJSON_IsString(ch) ? ch->valuestring : "?");
        cJSON_Delete(root);
        return;
    }

    ws_event_t e = { 0 };
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "id");
    e.id = cJSON_IsNumber(id) ? (long long)id->valuedouble : 0;
    if (cJSON_IsString(ev)) snprintf(e.event, sizeof(e.event), "%s", ev->valuestring);

    const cJSON *code = cJSON_GetObjectItemCaseSensitive(root, "code");
    if (cJSON_IsString(code)) snprintf(e.code, sizeof(e.code), "%s", code->valuestring);
    const cJSON *drink = cJSON_GetObjectItemCaseSensitive(root, "drink");
    if (cJSON_IsString(drink)) snprintf(e.drink, sizeof(e.drink), "%s", drink->valuestring);
    const cJSON *coins = cJSON_GetObjectItemCaseSensitive(root, "coins");
    if (cJSON_IsNumber(coins)) e.coins = coins->valueint;
    const cJSON *claim = cJSON_GetObjectItemCaseSensitive(root, "claim_token");
    if (cJSON_IsString(claim)) snprintf(e.claim_token, sizeof(e.claim_token), "%s", claim->valuestring);
    const cJSON *ttl = cJSON_GetObjectItemCaseSensitive(root, "expires_in_s");
    e.expires_in_s = cJSON_IsNumber(ttl) ? ttl->valueint : (int)BONUS_TTL_S;

    cJSON_Delete(root);

    if (strcmp(e.event, "bonus_ready") != 0) return;      /* інші події кіоску ні до чого */
    /* Доставка «принаймні раз» (backend/lib/src/outbox.js): повтор — норма, і саме
     * тому в події їде id. */
    if (e.id && already_seen(w, e.id)) {
        fprintf(stderr, "ws: подія %lld уже була, пропускаємо\n", e.id);
        return;
    }
    push_event(w, &e);
}

/* ─── життя одного зʼєднання ────────────────────────────────────────── */

/* Повертає код закриття: 0 — мережа впала, інакше код кадру close. */
static int run_connection(ws_client_t *w) {
    conn_t c = { 0 };
    char curl_url[320];
    snprintf(curl_url, sizeof(curl_url), "%s://%s:%s%s",
             w->tls ? "https" : "http", w->host, w->port, w->path);

    c.curl = curl_easy_init();
    if (!c.curl) return 0;
    curl_easy_setopt(c.curl, CURLOPT_URL, curl_url);
    curl_easy_setopt(c.curl, CURLOPT_CONNECT_ONLY, 1L);
    curl_easy_setopt(c.curl, CURLOPT_CONNECTTIMEOUT, (long)WS_CONNECT_TIMEOUT_S);
    curl_easy_setopt(c.curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode rc = curl_easy_perform(c.curl);
    if (rc != CURLE_OK) {
        fprintf(stderr, "ws: не підʼєднались до %s (%s)\n", curl_url, curl_easy_strerror(rc));
        curl_easy_cleanup(c.curl);
        return 0;
    }
    curl_socket_t sock = CURL_SOCKET_BAD;
    if (curl_easy_getinfo(c.curl, CURLINFO_ACTIVESOCKET, &sock) != CURLE_OK || sock == CURL_SOCKET_BAD) {
        curl_easy_cleanup(c.curl);
        return 0;
    }
    c.sock = sock;
    c.last_rx = now_s();

    if (!handshake(&c, w)) { curl_easy_cleanup(c.curl); return 0; }

    fprintf(stderr, "ws: зʼєднання встановлене (%s)\n", curl_url);
    pthread_mutex_lock(&w->lock); w->online = true; pthread_mutex_unlock(&w->lock);

    int close_code = 0;
    double last_ping = now_s();

    while (true) {
        pthread_mutex_lock(&w->lock);
        bool stop = w->stop;
        pthread_mutex_unlock(&w->lock);
        if (stop) { frame_send(&c, OP_CLOSE, NULL, 0); break; }

        /* Спершу розбираємо все, що вже лежить у буфері. */
        bool progressed = false;
        while (c.len >= 2) {
            frame_t f;
            bool need_more = false;
            if (!frame_parse(&c, &f, &need_more)) { close_code = 0; goto done; }
            if (need_more) break;

            if (f.opcode == OP_TEXT) handle_text(w, f.payload, f.len);
            else if (f.opcode == OP_PING) {
                unsigned char echo[125];
                size_t n = f.len < sizeof(echo) ? f.len : sizeof(echo);
                memcpy(echo, f.payload, n);
                conn_drop(&c, f.total);
                if (!frame_send(&c, OP_PONG, echo, n)) { close_code = 0; goto done; }
                progressed = true;
                continue;
            } else if (f.opcode == OP_CLOSE) {
                close_code = f.len >= 2 ? ((f.payload[0] << 8) | f.payload[1]) : 1005;
                conn_drop(&c, f.total);
                frame_send(&c, OP_CLOSE, NULL, 0);
                goto done;
            }
            conn_drop(&c, f.total);
            progressed = true;
        }
        if (progressed) continue;

        /* Пінг тримає зʼєднання живим через NAT кав'ярняного роутера, а
         * заодно ловить «мовчазний» обрив: мережа зникла, а сокет ще
         * виглядає відкритим. */
        double t = now_s();
        if (t - last_ping > WS_PING_PERIOD_S) {
            if (!frame_send(&c, OP_PING, NULL, 0)) { close_code = 0; goto done; }
            last_ping = t;
        }
        if (t - c.last_rx > WS_IDLE_LIMIT_S) {
            fprintf(stderr, "ws: тиша понад %.0f с — перепідключаємось\n", (double)WS_IDLE_LIMIT_S);
            close_code = 0;
            goto done;
        }

        bool timed_out = false;
        if (!conn_fill(&c, 1.0, &timed_out)) { close_code = 0; goto done; }
    }

done:
    pthread_mutex_lock(&w->lock); w->online = false; pthread_mutex_unlock(&w->lock);
    curl_easy_cleanup(c.curl);
    return close_code;
}

/* ─── потік ─────────────────────────────────────────────────────────── */

static void *ws_thread(void *arg) {
    ws_client_t *w = (ws_client_t *)arg;
    int attempt = 0;

    while (true) {
        pthread_mutex_lock(&w->lock);
        bool stop = w->stop;
        pthread_mutex_unlock(&w->lock);
        if (stop) break;

        int code = run_connection(w);

        pthread_mutex_lock(&w->lock);
        stop = w->stop;
        pthread_mutex_unlock(&w->lock);
        if (stop) break;

        double pause;
        if (code == 1001) {
            /* Сервер пішов на нову версію (docs/deploy.md §2.3) — нова копія
             * вже приймає зʼєднання, чекати нема чого. */
            attempt = 0;
            pause = 0.3;
        } else if (code == 4401) {
            /* Токен не прийняли. Кіоск не вміє його оновити сам, тож часті
             * спроби нічого не змінять — крім рядка в логах щохвилини. */
            fprintf(stderr, "ws: сервер відхилив токен (4401) — потрібен новий WS_TOKEN\n");
            attempt = 0;
            pause = WS_AUTH_RETRY_S;
        } else {
            attempt++;
            double base = 1.0 * (double)(1 << (attempt < 5 ? attempt : 5));
            pause = base > WS_MAX_PAUSE_S ? WS_MAX_PAUSE_S : base;
        }
        /* Розкид: після падіння сервера всі точки інакше постукають у нього
         * одночасно, рівно коли він піднімається. */
        pause *= 0.5 + (double)(rand() % 1000) / 2000.0;

        for (double slept = 0; slept < pause; slept += 0.1) {
            pthread_mutex_lock(&w->lock);
            stop = w->stop;
            pthread_mutex_unlock(&w->lock);
            if (stop) return NULL;
            sleep_s(0.1);
        }
    }
    return NULL;
}

/* ─── публічне ──────────────────────────────────────────────────────── */

static void parse_url(ws_client_t *w, const char *url) {
    w->tls = strncmp(url, "wss://", 6) == 0;
    const char *rest = url + (w->tls ? 6 : (strncmp(url, "ws://", 5) == 0 ? 5 : 0));

    const char *slash = strchr(rest, '/');
    const char *colon = strchr(rest, ':');
    if (colon && slash && colon > slash) colon = NULL;

    size_t host_len = colon ? (size_t)(colon - rest)
                            : (slash ? (size_t)(slash - rest) : strlen(rest));
    if (host_len >= sizeof(w->host)) host_len = sizeof(w->host) - 1;
    memcpy(w->host, rest, host_len);
    w->host[host_len] = '\0';

    if (colon) {
        size_t n = slash ? (size_t)(slash - colon - 1) : strlen(colon + 1);
        if (n >= sizeof(w->port)) n = sizeof(w->port) - 1;
        memcpy(w->port, colon + 1, n);
        w->port[n] = '\0';
    } else {
        snprintf(w->port, sizeof(w->port), "%s", w->tls ? "443" : "80");
    }

    snprintf(w->path, sizeof(w->path), "%s", slash && *slash ? slash : "/");
}

ws_client_t *ws_start(const char *url, const char *token) {
    ws_client_t *w = calloc(1, sizeof(*w));
    if (!w) return NULL;

    snprintf(w->url, sizeof(w->url), "%s", url ? url : "");
    snprintf(w->token, sizeof(w->token), "%s", token ? token : "");
    parse_url(w, w->url);
    pthread_mutex_init(&w->lock, NULL);

    fprintf(stderr, "ws: слухаю %s (%s:%s%s)\n", w->url, w->host, w->port, w->path);
    if (pthread_create(&w->thread, NULL, ws_thread, w) != 0) {
        fprintf(stderr, "ws: не вдалось запустити потік\n");
        pthread_mutex_destroy(&w->lock);
        free(w);
        return NULL;
    }
    return w;
}

int ws_drain(ws_client_t *w, ws_event_t *out, int max) {
    if (!w) return 0;
    int n = 0;
    pthread_mutex_lock(&w->lock);
    while (n < max && w->q_count > 0) {
        out[n++] = w->queue[w->q_head];
        w->q_head = (w->q_head + 1) % WS_QUEUE_CAP;
        w->q_count--;
    }
    pthread_mutex_unlock(&w->lock);
    return n;
}

bool ws_online(ws_client_t *w) {
    if (!w) return false;
    pthread_mutex_lock(&w->lock);
    bool online = w->online;
    pthread_mutex_unlock(&w->lock);
    return online;
}

void ws_stop(ws_client_t *w) {
    if (!w) return;
    pthread_mutex_lock(&w->lock);
    w->stop = true;
    pthread_mutex_unlock(&w->lock);
    pthread_join(w->thread, NULL);
    pthread_mutex_destroy(&w->lock);
    free(w);
}
