/* uploader.c — сегменти камери з флешки в R2 (docs/video.md, «Вивантаження»).
 *
 * Те саме, що stack/uploader.sh, тільки одним процесом (15.10.2026). На Pi 1
 * скрипт коштував процесора більше, ніж сама заливка: на кожен шматок файлу
 * — dd, щосекунди — sleep, щодві — ping із sed і head, а на кожен сегмент —
 * три curl із новим TLS-рукостисканням (~0,95 с CPU кожен). Тут з'єднань два
 * і вони живуть між сегментами (libcurl тримає їх у своєму кеші): до api —
 * посилання й реєстрація, до R2 — сама заливка. Темп регулюється всередині
 * колбека читання, а пінг — це час TCP-з'єднання з api, без жодного процесу.
 *
 * Логіка навмисно один в один зі скриптом, щоб телеметрія й адмінка не
 * помітили різниці: той самий порядок (найстаріші — першими), ті самі
 * рішення (400 від api, порожній файл, ім'я без часу → rejected/; 409 від
 * R2 → реєструємо наявний), ті самі файли стану (state/upload.cap,
 * upload.last, upload.queue) і ті самі рядки в лозі. Налаштування —
 * змінні оточення, які експортує uploader.sh перед exec.
 *
 * З 15.10.2026 черг дві: RAM (RECORDER_RAM — туди спершу пише recorder.sh)
 * і флешка. Готові з RAM ідуть першими, хвіст флешки — у решту часу.
 */
#define _GNU_SOURCE
/* 64-бітні stat/readdir на 32-бітному ARM: без цього stat() падає з
 * EOVERFLOW на великому номері inode чи файлі понад 2 ГБ, і сегмент для
 * аплоудера просто «не існує» (так і було під QEMU на теці з Windows). */
#define _FILE_OFFSET_BITS 64
#include <curl/curl.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#include "cJSON.h"

/* ── налаштування ─────────────────────────────────────────────────────── */
static const char *ROOT, *STATE, *API, *POINT, *TOKEN_FILE, *CAMERA, *PING_HOST;
static char DIRV[512], REJECT_DIR[600], CAP_FILE[600], MARK[600], QUEUE[600], CURRENT[600];
static char RAM_DIR[512];   /* сегменти в RAM (recorder.sh, RECORDER_RAM); порожньо — лише флешка */
static int MAX_KB, MIN_KB, RTT_SLACK_MS, RTT_QUIET_MS, BACKOFF_PCT, BAD_SAMPLES, MAX_PAUSE_S, BATCH;

static const char *env_or(const char *k, const char *d) {
    const char *v = getenv(k);
    return (v && *v) ? v : d;
}
static int env_int(const char *k, int d) {
    const char *v = getenv(k);
    return (v && *v) ? atoi(v) : d;
}
/* «800k» → 800, «1m» → 1024, «50000» → 48 — як rate_kb у скрипті. */
static int rate_kb(const char *s) {
    size_t n = strlen(s);
    if (n && (s[n - 1] == 'k' || s[n - 1] == 'K')) return atoi(s);
    if (n && (s[n - 1] == 'm' || s[n - 1] == 'M')) return atoi(s) * 1024;
    return atoi(s) / 1024;
}

/* ── лог і сигнали ────────────────────────────────────────────────────── */
static volatile sig_atomic_t STOPPING = 0;
static void on_term(int sig) { (void)sig; STOPPING = 1; }

static void logf_(const char *fmt, ...) {
    char ts[32]; time_t t = time(NULL); struct tm tm;
    localtime_r(&t, &tm);
    strftime(ts, sizeof ts, "%Y-%m-%d %H:%M:%S", &tm);
    printf("%s [uploader] ", ts);
    va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap);
    putchar('\n'); fflush(stdout);
}
/* say — лише коли повідомлення змінилось (як say у скрипті). */
static char LAST[512];
static void say(const char *fmt, ...) {
    char m[512]; va_list ap; va_start(ap, fmt); vsnprintf(m, sizeof m, fmt, ap); va_end(ap);
    if (strcmp(m, LAST) == 0) return;
    snprintf(LAST, sizeof LAST, "%s", m);
    logf_("%s", m);
}

static long long now_ms(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}
/* Сон, який перериває SIGTERM: nanosleep виходить із EINTR. */
static void nap_ms(long ms) {
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    while (!STOPPING && nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}
static void idle(int s) { if (!STOPPING) nap_ms((long)s * 1000); }

/* ── файли стану ──────────────────────────────────────────────────────── */
static void write_atomic(const char *path, const char *text) {
    char tmp[700]; snprintf(tmp, sizeof tmp, "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    if (!f) return;
    fputs(text, f); fclose(f);
    rename(tmp, path);
}
static int clamp(int v) { return v > MAX_KB ? MAX_KB : v < MIN_KB ? MIN_KB : v; }
static int cap_kb(void) {
    FILE *f = fopen(CAP_FILE, "r"); int c = MAX_KB;
    if (f) { if (fscanf(f, "%d", &c) != 1) c = MAX_KB; fclose(f); }
    return clamp(c);
}
static void cap_save(int kb) {
    char b[32]; snprintf(b, sizeof b, "%d\n", clamp(kb));
    write_atomic(CAP_FILE, b);
}

/* ── пінг: час TCP-з'єднання з api ────────────────────────────────────── */
/* ICMP без root не відправиш, а ping як процес — те, від чого й тікаємо.
 * Рукостискання TCP (SYN → SYN/ACK) — той самий один обмін через ту саму
 * чергу в роутері: коли заливка її забиває, він росте так само. Адресу
 * резолвимо раз і тримаємо; загубився пінг — перерезолвимо, але не частіше
 * ніж раз на 5 хв: втрата на заторі не означає, що адреса змінилась, а
 * getaddrinfo блокує колбек заливки на секунди, поки DNS не відповідає. */
static struct sockaddr_storage PING_ADDR; static socklen_t PING_LEN = 0;
static long long PING_RESOLVED = 0;
static int ping_resolve(void) {
    PING_RESOLVED = now_ms();
    struct addrinfo hints = {0}, *res = NULL;
    /* IPv4, як ping у скрипті; немає A-запису — що дасть резолвер. */
    hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(PING_HOST, "443", &hints, &res) != 0 || !res) {
        hints.ai_family = AF_UNSPEC; res = NULL;
        if (getaddrinfo(PING_HOST, "443", &hints, &res) != 0 || !res) return -1;
    }
    memcpy(&PING_ADDR, res->ai_addr, res->ai_addrlen); PING_LEN = res->ai_addrlen;
    freeaddrinfo(res);
    return 0;
}
static int rtt_ms(void) { /* мс або -1, якщо «загубився» (2 с) */
    if (!PING_LEN && ping_resolve() != 0) return -1;
    int s = socket(PING_ADDR.ss_family, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (s < 0) return -1;
    long long t0 = now_ms();
    /* Відмова (RST) — теж відповідь із того боку, тобто повний обмін. */
    int r = connect(s, (struct sockaddr *)&PING_ADDR, PING_LEN), ms = -1;
    if (r == 0 || errno == ECONNREFUSED) ms = (int)(now_ms() - t0);
    else if (errno == EINPROGRESS) {
        struct pollfd p = { s, POLLOUT, 0 };
        if (poll(&p, 1, 2000) == 1) {
            int err = 0; socklen_t l = sizeof err;
            getsockopt(s, SOL_SOCKET, SO_ERROR, &err, &l);
            if (!err || err == ECONNREFUSED) ms = (int)(now_ms() - t0);
        }
    }
    /* Закриваємо RST-ом (linger 0), а не FIN: без TIME_WAIT на малині й без
     * зайвого обміну пакетами в і так забитому каналі. */
    struct linger lg = { 1, 0 };
    setsockopt(s, SOL_SOCKET, SO_LINGER, &lg, sizeof lg);
    close(s);
    if (ms < 0 && now_ms() - PING_RESOLVED > 300000) PING_LEN = 0;
    return ms;
}

/* ── темп заливки (pace у скрипті) ────────────────────────────────────── */
/* По «секунді» темпу за раз: libcurl просить дані, коли сокет готовий їх
 * узяти, — колбек віддає, поки секундна порція не вичерпана, і чекає
 * решту секунди. Порція йде довше 1,5 с — канал вужчий за темп: темп —
 * BACKOFF_PCT від того, що реально пройшло. Щодві секунди — пінг: понад
 * базу на RTT_SLACK_MS чи загублений BAD_SAMPLES разів поспіль — темп
 * ×BACKOFF_PCT; тихо (нижче бази + RTT_QUIET_MS) — ×1,25. */
typedef struct {
    FILE *f;
    long long left;            /* байтів файла ще не віддано */
    int rate;                  /* КБ/с */
    long long win_t0;          /* початок поточної «секунди»; 0 — передача ще не почалась */
    long long win_sent;        /* байтів у ній */
    long long pinged;
    int base, bad;
} Pace;

static void pace_tick(Pace *p) {
    long long t = now_ms();
    if (t - p->pinged < 2000) return;
    p->pinged = t;
    int r = p->base >= 0 ? rtt_ms() : -1;
    if (p->base >= 0 && (r < 0 || r > p->base + RTT_SLACK_MS)) {
        if (++p->bad >= BAD_SAMPLES) { p->rate = p->rate * BACKOFF_PCT / 100; p->bad = 0; }
    } else {
        p->bad = 0;
        if (p->base < 0 || r < p->base + RTT_QUIET_MS) p->rate = p->rate * 5 / 4 + 1;
    }
    if (r >= 0 && (p->base < 0 || r < p->base)) p->base = r;
    p->rate = clamp(p->rate); cap_save(p->rate);
}

static size_t pace_read(char *buf, size_t size, size_t n, void *ud) {
    Pace *p = ud;
    if (STOPPING) return CURL_READFUNC_ABORT;
    if (p->left <= 0) return 0;
    long long t = now_ms(), quota = (long long)p->rate * 1024;
    /* Перша «секунда» — з першого виклику, а не з початку upload_one: до
     * нього йдуть TLS-рукостискання й Expect: 100-continue, і вони не
     * повинні виглядати як вузький канал. */
    if (!p->win_t0) p->win_t0 = t;
    long long el = t - p->win_t0;
    if (el > 1500) {
        /* curl не встигає забрати порцію за півтори секунди — канал вужчий
         * за темп: новий темп — BACKOFF_PCT від того, що реально пройшло. */
        long long kbs = p->win_sent * 1000 / 1024 / el;
        p->rate = clamp((int)(kbs * BACKOFF_PCT / 100)); cap_save(p->rate);
        p->win_t0 = t; p->win_sent = 0; quota = (long long)p->rate * 1024;
    } else if (p->win_sent >= quota) {
        /* Порція віддана — доспати решту секунди, пінг і нова порція. */
        if (el < 1000) nap_ms((long)(1000 - el));
        if (STOPPING) return CURL_READFUNC_ABORT;
        pace_tick(p);
        p->win_t0 = now_ms(); p->win_sent = 0; quota = (long long)p->rate * 1024;
    }
    size_t want = size * n;
    long long room = quota - p->win_sent;
    if ((long long)want > room) want = (size_t)room;
    if ((long long)want > p->left) want = (size_t)p->left;
    size_t got = fread(buf, 1, want, p->f);
    /* Файл коротший, ніж був на stat (обрізали з-під нас) — обрив, а не
     * «кінець файла»: R2 однаково не прийме менше за Content-Length. */
    if (got == 0) return CURL_READFUNC_ABORT;
    p->left -= got; p->win_sent += got;
    return got;
}

static int xfer_abort(void *ud, curl_off_t a, curl_off_t b, curl_off_t c, curl_off_t d) {
    (void)ud; (void)a; (void)b; (void)c; (void)d;
    return STOPPING ? 1 : 0;
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */
static CURL *API_H, *R2_H;   /* живуть увесь час: з'єднання й TLS-сесії — у їхніх кешах */
static char TOKEN[1024];

typedef struct { char *p; size_t n; } Buf;
static size_t buf_write(char *d, size_t s, size_t n, void *ud) {
    Buf *b = ud; size_t k = s * n;
    char *q = realloc(b->p, b->n + k + 1);
    if (!q) return 0;
    b->p = q; memcpy(b->p + b->n, d, k); b->n += k; b->p[b->n] = 0;
    return k;
}

/* api_post <шлях> <json> → 0 — 2xx; 2 — 400 (сервер забракував сам запит,
 * повтор нічого не змінить); 1 — решта (мережа, 5xx, 401/403/429). Тіло
 * відповіді — у *out (звільнити free). */
static int api_post(const char *path, const char *json, char **out) {
    char url[1024], auth[1200];
    snprintf(url, sizeof url, "%s/points/%s%s", API, POINT, path);
    snprintf(auth, sizeof auth, "authorization: Bearer %s", TOKEN);
    struct curl_slist *h = curl_slist_append(NULL, auth);
    h = curl_slist_append(h, "content-type: application/json");
    Buf b = {0};
    curl_easy_reset(API_H);   /* скидає опції, але не кеш з'єднань */
    curl_easy_setopt(API_H, CURLOPT_URL, url);
    curl_easy_setopt(API_H, CURLOPT_HTTPHEADER, h);
    curl_easy_setopt(API_H, CURLOPT_POSTFIELDS, json);
    curl_easy_setopt(API_H, CURLOPT_TIMEOUT, 30L);
    curl_easy_setopt(API_H, CURLOPT_TCP_KEEPALIVE, 1L);
    curl_easy_setopt(API_H, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(API_H, CURLOPT_WRITEFUNCTION, buf_write);
    curl_easy_setopt(API_H, CURLOPT_WRITEDATA, &b);
    curl_easy_setopt(API_H, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(API_H, CURLOPT_XFERINFOFUNCTION, xfer_abort);
    CURLcode rc = curl_easy_perform(API_H);
    long code = 0; curl_easy_getinfo(API_H, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(h);
    if (out) *out = b.p ? b.p : strdup(""); else free(b.p);
    if (rc != CURLE_OK) return 1;
    if (code >= 200 && code < 300) return 0;
    return code == 400 ? 2 : 1;
}

/* ── сегменти ─────────────────────────────────────────────────────────── */
/* Час початку з імені: «…Z.mkv» — UTC (recorder з 06.10.2026), без Z —
 * місцевий час малини (сегменти, записані раніше). 0 — не розібрали. */
static time_t start_epoch(const char *name) {
    struct tm tm = {0}; char z = 0;
    if (sscanf(name, "%4d%2d%2dT%2d%2d%2d%c", &tm.tm_year, &tm.tm_mon, &tm.tm_mday,
               &tm.tm_hour, &tm.tm_min, &tm.tm_sec, &z) < 6) return 0;
    tm.tm_year -= 1900; tm.tm_mon -= 1; tm.tm_isdst = -1;
    return z == 'Z' ? timegm(&tm) : mktime(&tm);
}

/* Копія файла (для переносу з RAM на флешку, де rename не працює — EXDEV). */
static int copy_file(const char *src, const char *dst) {
    FILE *a = fopen(src, "rb"), *b = a ? fopen(dst, "wb") : NULL;
    char buf[65536]; size_t k; int ok = a && b;
    while (ok && (k = fread(buf, 1, sizeof buf, a)) > 0) ok = fwrite(buf, 1, k, b) == k;
    if (ok && ferror(a)) ok = 0;
    if (a) fclose(a);
    if (b && fclose(b) != 0) ok = 0;
    if (!ok) unlink(dst);
    return ok ? 0 : -1;
}

static void reject(const char *path, const char *name, const char *why) {
    char dst[1200];
    mkdir(REJECT_DIR, 0755);
    snprintf(dst, sizeof dst, "%s/%s", REJECT_DIR, name);
    int ok = rename(path, dst) == 0;
    /* Сегмент із RAM: rejected/ — на флешці, інша файлова система. */
    if (!ok && errno == EXDEV && copy_file(path, dst) == 0) { unlink(path); ok = 1; }
    if (ok) logf_("%s: %s — переніс у rejected/, беру наступний", name, why);
}

/* Замір для телеметрії — як upload_mark у скрипті: лише коли канал справді
 * щось віз (вдалось або обірвалось за таймаутом із байтами в дорозі). */
/* fresh — для цієї заливки довелось відкривати нове зʼєднання з R2 (TLS із
 * нуля, ~0,7 с CPU на Pi 1); у штатному ритмі його бути не повинно. */
static void upload_mark(const char *name, int rc, int start_cap, double bytes, double secs, long fresh) {
    double kb = secs > 0 ? bytes / 1024 / secs : 0;
    int end_cap = cap_kb();
    if (rc == 0 || (rc == CURLE_OPERATION_TIMEDOUT && bytes > 0)) {
        char b[128];
        snprintf(b, sizeof b, "%ld %d %.0f %.3f %d\n", (long)time(NULL), rc == 0, bytes, secs, end_cap);
        write_atomic(MARK, b);
    }
    /* Цілі КБ і секунди — відкинутим дробом, як $((_b / 1024)) і ${_s%.*}. */
    long long ikb = (long long)bytes / 1024; long isecs = (long)secs;
    if (rc == 0)
        logf_("%s: %lld КБ за %ld с — у середньому %.1f КБ/с (темп %d → %d)%s", name, ikb, isecs, kb, start_cap, end_cap,
              fresh ? ", нове зʼєднання" : "");
    else
        logf_("%s: обрив (curl %d) після %lld КБ за %ld с — %.1f КБ/с (темп %d → %d)", name, rc, ikb, isecs, kb, start_cap, end_cap);
}

static int register_segment(const char *key, long long bytes, time_t at, char **out) {
    char body[1024];
    snprintf(body, sizeof body, "{\"key\":\"%s\",\"bytes\":%lld,\"started_at\":%ld,\"camera\":\"%s\"}", key, bytes, (long)at, CAMERA);
    return api_post("/video/segment", body, out);
}

/* upload_one → 0 залито, 3 відкладено в rejected/, 1 збій (повторимо),
 * 4 файла вже немає (recorder переніс його з RAM на флешку чи prune стер) —
 * не збій, наступний прохід знайде його там, де він тепер. */
static int upload_one(const char *path, const char *name, int mark) {
    struct stat st;
    if (stat(path, &st) != 0) return errno == ENOENT ? 4 : 1;
    long long bytes = st.st_size;
    time_t at = start_epoch(name);
    if (!at) { reject(path, name, "не розібрав час з імені"); return 3; }
    if (bytes <= 0) { reject(path, name, "порожній файл"); return 3; }
    const char *type = strstr(name, ".mkv") ? "video/x-matroska" : "video/mp2t";

    char body[1024], *resp = NULL;
    snprintf(body, sizeof body, "{\"name\":\"%s\",\"bytes\":%lld,\"started_at\":%ld,\"camera\":\"%s\"}", name, bytes, (long)at, CAMERA);
    int r = api_post("/video/upload", body, &resp);
    if (r == 2) {
        char why[256]; snprintf(why, sizeof why, "api відкинув: %.160s", resp);
        free(resp); reject(path, name, why); return 3;
    }
    if (r != 0) { free(resp); return 1; }
    cJSON *j = cJSON_Parse(resp); free(resp);
    const cJSON *u = j ? cJSON_GetObjectItemCaseSensitive(j, "url") : NULL;
    const cJSON *k = j ? cJSON_GetObjectItemCaseSensitive(j, "key") : NULL;
    if (!cJSON_IsString(u) || !cJSON_IsString(k)) { cJSON_Delete(j); logf_("%s: api не дав посилання", name); return 1; }
    char *url = strdup(u->valuestring), *key = strdup(k->valuestring);
    cJSON_Delete(j);

    /* mark — сегмент із RAM: позначаємо, що саме його читаємо, щоб recorder
     * не переніс його на флешку посеред заливки (знімає позначку той, хто
     * кличе, — уже після того, як локальну копію стерто). Не раніше: поки
     * api не дав посилання, файл ще не читаємо, і переносити його можна. */
    if (mark) write_atomic(CURRENT, path);
    FILE *f = fopen(path, "rb");
    if (!f) { int gone = errno == ENOENT; free(url); free(key); return gone ? 4 : 1; }
    int start_cap = cap_kb();
    Pace p = { f, bytes, start_cap, 0, 0, 0, -1, 0 };
    /* Базова затримка — поки канал ще вільний від нас. Не відповідає зовсім
     * — живемо лише на сигналі «curl не встигає». */
    for (int i = 0; i < 3 && !STOPPING; i++) { int x = rtt_ms(); if (x >= 0 && (p.base < 0 || x < p.base)) p.base = x; }
    p.pinged = now_ms();

    char ctype[128]; snprintf(ctype, sizeof ctype, "content-type: %s", type);
    struct curl_slist *h = curl_slist_append(NULL, ctype);
    /* --max-time — на найгірший випадок: увесь файл на нижній межі, з
     * запасом у півтора раза (підписане посилання живе годину). */
    long mt = (long)(bytes / ((long long)MIN_KB * 1024) * 3 / 2 + 60); if (mt < 300) mt = 300;
    curl_easy_reset(R2_H);
    curl_easy_setopt(R2_H, CURLOPT_URL, url);
    curl_easy_setopt(R2_H, CURLOPT_UPLOAD, 1L);
    curl_easy_setopt(R2_H, CURLOPT_INFILESIZE_LARGE, (curl_off_t)bytes);
    curl_easy_setopt(R2_H, CURLOPT_READFUNCTION, pace_read);
    curl_easy_setopt(R2_H, CURLOPT_READDATA, &p);
    curl_easy_setopt(R2_H, CURLOPT_HTTPHEADER, h);
    /* IPv4: на 4G точки IPv6 до R2 зламаний (09.10.2026, див. uploader.sh). */
    curl_easy_setopt(R2_H, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_easy_setopt(R2_H, CURLOPT_LOW_SPEED_LIMIT, 2000L);
    curl_easy_setopt(R2_H, CURLOPT_LOW_SPEED_TIME, 30L);
    curl_easy_setopt(R2_H, CURLOPT_TIMEOUT, mt);
    curl_easy_setopt(R2_H, CURLOPT_TCP_KEEPALIVE, 1L);
    curl_easy_setopt(R2_H, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(R2_H, CURLOPT_WRITEFUNCTION, buf_write);
    Buf sink = {0};
    curl_easy_setopt(R2_H, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(R2_H, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(R2_H, CURLOPT_XFERINFOFUNCTION, xfer_abort);
    CURLcode rc = curl_easy_perform(R2_H);
    long code = 0; double up = 0, secs = 0;
    curl_easy_getinfo(R2_H, CURLINFO_RESPONSE_CODE, &code);
#if LIBCURL_VERSION_NUM >= 0x073700   /* _T з 7.55; на малині Stretch — 7.52 */
    curl_off_t upt = 0; curl_easy_getinfo(R2_H, CURLINFO_SIZE_UPLOAD_T, &upt); up = (double)upt;
#else
    curl_easy_getinfo(R2_H, CURLINFO_SIZE_UPLOAD, &up);
#endif
    curl_easy_getinfo(R2_H, CURLINFO_TOTAL_TIME, &secs);
    curl_slist_free_all(h); free(sink.p); fclose(f);
    /* HTTP-помилка — як у curl -f: код 22. */
    int crc = rc != CURLE_OK ? (int)rc : (code >= 400 ? 22 : 0);
    long fresh = 0; curl_easy_getinfo(R2_H, CURLINFO_NUM_CONNECTS, &fresh);
    upload_mark(name, crc, start_cap, up, secs, fresh);

    int ret = 1;
    if (crc == 22 && code == 409) {
        /* 409 від R2: об'єкт уже є, а bucket lock (7 днів) перезаписати не
         * дає. Реєструємо наявний — api звіряє розмір HEAD-ом (див. uploader.sh). */
        char *seg = NULL;
        int g = register_segment(key, bytes, at, &seg);
        if (g == 0) { logf_("%s: уже лежав у R2 (409) — зареєстрував наявний", name); unlink(path); ret = 0; }
        else if (seg && strstr(seg, "size_mismatch")) { reject(path, name, "у R2 під цим ключем інший розмір (409), а перезаписати не дає bucket lock"); ret = 3; }
        free(seg);
    } else if (crc == 0) {
        if (register_segment(key, bytes, at, NULL) == 0) { unlink(path); ret = 0; }
    }
    free(url); free(key);
    return ret;
}

static int by_name(const struct dirent **a, const struct dirent **b) { return strcmp((*a)->d_name, (*b)->d_name); }
static int is_segment(const struct dirent *d) {
    size_t n = strlen(d->d_name);
    return (n > 4 && strcmp(d->d_name + n - 4, ".mkv") == 0) || (n > 3 && strcmp(d->d_name + n - 3, ".ts") == 0);
}

/* collect <тека> <ram> — готові сегменти теки за абеткою (імена — час
 * запису, тож найстаріші першими): до cap шляхів у кінець q, у відповідь —
 * скільки їх усього, а *oldest — час найстарішого. Готовий на флешці — той,
 * що не мінявся понад хвилину (ffmpeg його вже не дописує). У RAM ffmpeg
 * пише лише в найновіший, тож готові — усі інші, а найновіший — лише коли
 * не мінявся понад хвилину (ffmpeg стоїть: камера пропала). */
typedef struct { char path[600]; } Seg;
static Seg *QUEUE_SEGS;   /* до 2×BATCH: спершу з RAM, далі з флешки */
static int collect(const char *dir, int ram, Seg *q, int *nq, int cap, time_t now, time_t *oldest) {
    struct dirent **list = NULL;
    int m = scandir(dir, &list, is_segment, by_name), ready = 0;
    for (int i = 0; i < m; i++) {
        char path[600]; struct stat st;
        snprintf(path, sizeof path, "%s/%s", dir, list[i]->d_name);
        if (stat(path, &st) == 0 && S_ISREG(st.st_mode) && (now - st.st_mtime > 60 || (ram && i < m - 1))) {
            if (!ready) { time_t e = start_epoch(list[i]->d_name); if (e && (!*oldest || e < *oldest)) *oldest = e; }
            ready++;
            if (*nq < cap) snprintf(q[(*nq)++].path, sizeof q[0].path, "%s", path);
        }
        free(list[i]);
    }
    free(list);
    return ready;
}
static int ram_ready(void) {
    int nq = 0; time_t o = 0;
    return RAM_DIR[0] ? collect(RAM_DIR, 1, NULL, &nq, 0, time(NULL), &o) : 0;
}

static int read_token(void) {
    FILE *f = fopen(TOKEN_FILE, "r");
    if (!f) return -1;
    size_t n = fread(TOKEN, 1, sizeof TOKEN - 1, f); fclose(f);
    TOKEN[n] = 0;
    while (n && (TOKEN[n - 1] == '\n' || TOKEN[n - 1] == '\r' || TOKEN[n - 1] == ' ')) TOKEN[--n] = 0;
    return n ? 0 : -1;
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    ROOT = env_or("EXTROVERT_ROOT", "/home/pi/extrovert");
    static char st[512]; snprintf(st, sizeof st, "%s/state", ROOT);
    STATE = env_or("EXTROVERT_STATE", st);
    API = env_or("API_URL", "https://api.extrovert.cafe/api/v1");
    POINT = env_or("POINT", "kyiv-01");
    static char tok[512]; snprintf(tok, sizeof tok, "%s/config/point.key", ROOT);
    TOKEN_FILE = env_or("WS_TOKEN_FILE", tok);
    CAMERA = env_or("RECORDER_CAMERA", "cam1");
    PING_HOST = env_or("UPLOAD_PING_HOST", env_or("TELEMETRY_PING_HOST", "api.extrovert.cafe"));
    const char *buf = getenv("RECORDER_BUF"); if (!buf) buf = "/mnt/buf";
    snprintf(DIRV, sizeof DIRV, "%s/video", buf);
    snprintf(REJECT_DIR, sizeof REJECT_DIR, "%s/rejected", DIRV);
    snprintf(CAP_FILE, sizeof CAP_FILE, "%s/upload.cap", STATE);
    snprintf(MARK, sizeof MARK, "%s/upload.last", STATE);
    snprintf(QUEUE, sizeof QUEUE, "%s/upload.queue", STATE);
    snprintf(CURRENT, sizeof CURRENT, "%s/upload.current", STATE);
    const char *ramd = getenv("RECORDER_RAM"); if (!ramd) ramd = "/dev/shm/extrovert-video";
    snprintf(RAM_DIR, sizeof RAM_DIR, "%s", ramd);
    MAX_KB = rate_kb(env_or("UPLOAD_RATE", "800k"));
    MIN_KB = env_int("UPLOAD_MIN_KB", 32);
    RTT_SLACK_MS = env_int("UPLOAD_RTT_SLACK_MS", 400);
    RTT_QUIET_MS = env_int("UPLOAD_RTT_QUIET_MS", 150);
    BACKOFF_PCT = env_int("UPLOAD_BACKOFF_PCT", 80);
    BAD_SAMPLES = env_int("UPLOAD_BAD_SAMPLES", 2);
    MAX_PAUSE_S = env_int("UPLOAD_MAX_PAUSE_S", 120);
    BATCH = env_int("UPLOAD_BATCH", 20);
    if (BATCH < 1) BATCH = 1;
    QUEUE_SEGS = calloc(2 * (size_t)BATCH, sizeof(Seg));

    /* Відео — найнижчий пріоритет на процесорі й диску (nice 10, ionice idle). */
    if (setpriority(PRIO_PROCESS, 0, 10) != 0) {}
    syscall(SYS_ioprio_set, 1 /* IOPRIO_WHO_PROCESS */, 0, 3 << 13 /* IOPRIO_CLASS_IDLE */);

    struct sigaction sa = {0}; sa.sa_handler = on_term;
    sigaction(SIGTERM, &sa, NULL); sigaction(SIGINT, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    curl_global_init(CURL_GLOBAL_DEFAULT);
    API_H = curl_easy_init(); R2_H = curl_easy_init();
    mkdir(STATE, 0755);
    logf_("старт (C), черга %s%s%s → %s, темп %d КБ/с (межі %d…%d, пінг до %s)", RAM_DIR[0] ? RAM_DIR : "", RAM_DIR[0] ? " і " : "",
          DIRV, API, cap_kb(), MIN_KB, MAX_KB, PING_HOST);

    int fails = 0;
    while (!STOPPING) {
        if (read_token() != 0) { say("немає ключа точки %s — вантажити нікуди", TOKEN_FILE); idle(300); continue; }
        /* Спершу RAM, потім флешка (recorder.sh, «Спершу в RAM»): свіжий
         * сегмент іде в R2 прямо з памʼяті й на флешку не потрапляє зовсім,
         * а хвіст на флешці доганяємо в решту часу, найстаріші першими. */
        time_t t = time(NULL), oldest = 0;
        int nq = 0, ram = 0, ready = 0;
        if (RAM_DIR[0]) ready = ram = collect(RAM_DIR, 1, QUEUE_SEGS, &nq, BATCH, t, &oldest);
        if (ram > BATCH) ram = BATCH;
        ready += collect(DIRV, 0, QUEUE_SEGS, &nq, 2 * BATCH, t, &oldest);
        /* Черга для телеметрії: скільки готових чекає й з якого часу найстаріший. */
        char qs[64]; snprintf(qs, sizeof qs, "%d %ld\n", ready, (long)(ready ? oldest : 0));
        write_atomic(QUEUE, qs);
        if (!ready) { idle(30); continue; }

        int done = 0, skipped = 0, failed = 0, tried = 0;
        for (int i = 0; i < nq && tried < BATCH && !STOPPING; i++) {
            /* Хвіст флешки — лише поки в RAM не готовий новий: інакше за
             * прохід (до BATCH сегментів, десятки хвилин) recorder переніс би
             * свіжі на флешку, і користі від RAM не було б. */
            if (i >= ram && ram_ready() > 0) break;
            tried++;
            const char *path = QUEUE_SEGS[i].path, *name = strrchr(path, '/') + 1;
            int r = upload_one(path, name, i < ram);
            if (i < ram) unlink(CURRENT);
            if (r == 0 || r == 3) done++;   /* 3 — відкладено в rejected/: черга йде далі */
            else if (r == 4) skipped++;     /* файл переїхав — наступний прохід знайде */
            else {
                fails++; failed = 1;
                if (fails == 1) logf_("%s: заливка не вдалась — повторю пізніше", name);
                break;
            }
        }
        if (done > 0 || (skipped > 0 && !failed)) {
            if (done > 0) {
                if (fails > 0) logf_("заливка відновилась після %d невдалих спроб", fails);
                fails = 0;
                say("вантажу: залито %d за прохід", done);
            }
            continue;
        }
        if (STOPPING) break;
        /* Збій — пауза 30 → 60 → … до MAX_PAUSE_S (uploader.sh, 15.10.2026). */
        int w = 30;
        for (int k = 1; k < fails && w < MAX_PAUSE_S; k++) w *= 2;
        if (w > MAX_PAUSE_S) w = MAX_PAUSE_S;
        idle(w);
    }
    unlink(CURRENT);
    logf_("зупинено");
    curl_easy_cleanup(API_H); curl_easy_cleanup(R2_H);
    curl_global_cleanup();
    return 0;
}
