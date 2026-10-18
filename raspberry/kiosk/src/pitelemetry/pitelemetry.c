/* pitelemetry.c — bin/telemetry: проби точки в api (stack/telemetry.sh).
 *
 * Те саме, що telemetry.sh, одним процесом (15.10.2026). Скрипт щохвилини
 * запускав кілька десятків коротких процесів (awk, sed, date, timeout, nc,
 * timedatectl…) і curl із новим TLS-рукостисканням (~0,95 с CPU на Pi 1),
 * а все разом — кілька секунд процесора на хвилину в кіоска. Тут з'єднання
 * з api живе між пробами, а /proc, сокет кіоска, флешка й маршрут читаються
 * напряму. Окремими процесами лишились тільки ping (ICMP без root не
 * відправиш) і cec-client раз на TELEMETRY_MONITOR_PROBE_S — як у скрипті.
 *
 * Поведінка навмисно один в один зі скриптом: ті самі метрики й формат
 * проби, та сама черга state/telemetry.queue (і перештампування часу після
 * стрибка годинника), ті самі рядки в лозі, той самий пульс для супервізора.
 * Коментарі «чому» — у telemetry.sh: тут лише те, що відрізняється.
 *
 * Чого в скрипті немає зовсім — помилок ядра (17.10.2026): їх читає окремий
 * потік і шле, щойно вони з'явились (розділ «ядро» нижче). У пробі скрипта
 * kernel_errors завжди null.
 */
#define _GNU_SOURCE
#define _FILE_OFFSET_BITS 64
#include <curl/curl.h>
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <limits.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/syscall.h>
#include <sys/timex.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "../ssl_locks.h"

/* ── налаштування ─────────────────────────────────────────────────────── */
static const char *ROOT, *STATE, *API, *POINT, *TOKEN_FILE, *PING_HOST, *BUF, *RAMD;
static char QUEUE[600], BEAT[600], MON_CACHE[600], CAM_ENV[600], CURRENT_LINK[600];
static int PERIOD, MONITOR_PROBE_S, AUTOWAKE;
#define QUEUE_MAX 500
#define BATCH_MAX 200

static const char *env_or(const char *k, const char *d) { const char *v = getenv(k); return (v && *v) ? v : d; }
static int env_int(const char *k, int d) { const char *v = getenv(k); return (v && *v) ? atoi(v) : d; }

static volatile sig_atomic_t STOPPING = 0;
static void on_term(int s) { (void)s; STOPPING = 1; }

static void logf_(const char *fmt, ...) {
    char ts[32]; time_t t = time(NULL); struct tm tm; localtime_r(&t, &tm);
    strftime(ts, sizeof ts, "%Y-%m-%d %H:%M:%S", &tm);
    printf("%s [telemetry] ", ts);
    va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap);
    putchar('\n'); fflush(stdout);
}

static void nap_ms(long ms) {
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    while (!STOPPING && nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}

/* ── дрібні читачі файлів ─────────────────────────────────────────────── */
static int read_file(const char *path, char *buf, size_t n) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    size_t got = 0; ssize_t k;
    /* До кінця: файли /proc віддаються шматками. */
    while (got + 1 < n && (k = read(fd, buf + got, n - 1 - got)) > 0) got += (size_t)k;
    close(fd);
    buf[got] = 0;
    return (int)got;
}
static void write_atomic(const char *path, const char *text) {
    char tmp[700]; snprintf(tmp, sizeof tmp, "%s.tmp", path);
    FILE *f = fopen(tmp, "w"); if (!f) return;
    fputs(text, f); fclose(f); rename(tmp, path);
}
static void iso_utc(time_t t, char *out, size_t n) {
    struct tm tm; gmtime_r(&t, &tm); strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tm);
}
static double uptime_now(void) {
    char b[64]; return read_file("/proc/uptime", b, sizeof b) > 0 ? atof(b) : 0;
}

/* Дочірній процес із захопленням stdout і дедлайном (ping, cec-client).
 * stdin_text — що подати на stdin (або NULL). → код виходу, -1 — не вклався. */
static int run_capture(char *const argv[], const char *stdin_text, int timeout_s, char *out, size_t outn) {
    int po[2], pi[2] = { -1, -1 };
    if (pipe2(po, O_CLOEXEC) != 0) return -1;
    if (stdin_text && pipe2(pi, O_CLOEXEC) != 0) { close(po[0]); close(po[1]); return -1; }
    pid_t pid = fork();
    if (pid < 0) { close(po[0]); close(po[1]); if (stdin_text) { close(pi[0]); close(pi[1]); } return -1; }
    if (pid == 0) {
        /* Лишається в групі компонента: супервізор гасить усю групу, тож
         * завислий cec-client не переживе перезапуску телеметрії. */
        dup2(po[1], 1);
        int dn = open("/dev/null", O_RDWR);
        dup2(dn, 2);
        if (stdin_text) dup2(pi[0], 0); else dup2(dn, 0);
        signal(SIGPIPE, SIG_DFL);
        execvp(argv[0], argv);
        _exit(127);
    }
    close(po[1]);
    if (stdin_text) {
        close(pi[0]);
        ssize_t w = write(pi[1], stdin_text, strlen(stdin_text)); (void)w;
        close(pi[1]);
    }
    size_t got = 0; time_t deadline = time(NULL) + timeout_s; int timed_out = 0;
    for (;;) {
        int left = (int)(deadline - time(NULL));
        if (left <= 0) { timed_out = 1; break; }
        struct pollfd p = { po[0], POLLIN, 0 };
        int r = poll(&p, 1, left * 1000);
        if (r < 0 && errno == EINTR) { if (STOPPING) { timed_out = 1; break; } continue; }
        if (r <= 0) { timed_out = 1; break; }
        char tmp[4096]; ssize_t k = read(po[0], tmp, sizeof tmp);
        if (k <= 0) break;
        if (out && got + 1 < outn) {
            size_t c = (size_t)k; if (got + c >= outn) c = outn - 1 - got;
            memcpy(out + got, tmp, c); got += c;
        }
    }
    close(po[0]);
    if (out) out[got] = 0;
    /* stdout закрився — чекаємо на вихід, але теж не довше дедлайну. */
    int st = 0;
    while (!timed_out) {
        pid_t w = waitpid(pid, &st, WNOHANG);
        if (w == pid) return WIFEXITED(st) ? WEXITSTATUS(st) : -1;
        if (w < 0 && errno != EINTR) return -1;
        if (STOPPING || time(NULL) >= deadline) timed_out = 1;
        else { struct timespec ts = { 0, 50000000L }; nanosleep(&ts, NULL); }
    }
    kill(pid, SIGKILL);
    while (waitpid(pid, &st, 0) < 0 && errno == EINTR) {}
    return -1;
}
static int have_cmd(const char *name) {
    const char *path = getenv("PATH"); if (!path) path = "/usr/bin:/bin";
    char buf[1024]; const char *p = path;
    while (*p) {
        const char *e = strchr(p, ':'); size_t l = e ? (size_t)(e - p) : strlen(p);
        snprintf(buf, sizeof buf, "%.*s/%s", (int)l, p, name);
        if (access(buf, X_OK) == 0) return 1;
        if (!e) break;
        p = e + 1;
    }
    return 0;
}

/* ── метрики ──────────────────────────────────────────────────────────── */
static void cpu_read(unsigned long long *tot, unsigned long long *idle) {
    char b[512]; unsigned long long v[7] = {0};
    *tot = *idle = 0;
    if (read_file("/proc/stat", b, sizeof b) <= 0) return;
    if (sscanf(b, "cpu %llu %llu %llu %llu %llu %llu %llu", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6]) < 4) return;
    for (int i = 0; i < 7; i++) *tot += v[i];
    *idle = v[3];
}
/* Миттєве завантаження: дві проби з паузою в секунду (як cpu_percent). */
static int cpu_percent(char *out, size_t n) {
    unsigned long long t1, i1, t2, i2;
    cpu_read(&t1, &i1); nap_ms(1000); cpu_read(&t2, &i2);
    double dt = (double)(t2 - t1), di = (double)(i2 - i1);
    snprintf(out, n, "%.0f", dt > 0 ? (1 - di / dt) * 100 : 0);
    return 0;
}
static void temp_c(char *out, size_t n) {
    char b[64];
    if (read_file("/sys/class/thermal/thermal_zone0/temp", b, sizeof b) > 0) snprintf(out, n, "%.1f", atof(b) / 1000);
    else snprintf(out, n, "null");
}
static void mem_mb(char *used, char *total, size_t n) {
    char b[2048]; long t = -1, a = -1;
    snprintf(used, n, "null"); snprintf(total, n, "null");
    if (read_file("/proc/meminfo", b, sizeof b) <= 0) return;
    char *p = strstr(b, "MemTotal:"); if (p) t = atol(p + 9);
    p = strstr(b, "MemAvailable:"); if (p) a = atol(p + 13);
    if (t >= 0) snprintf(total, n, "%.0f", t / 1024.0);
    if (t >= 0 && a >= 0) snprintf(used, n, "%.0f", (t - a) / 1024.0);
}
static void disk_free_mb(char *out, size_t n) {
    struct statvfs s;
    if (statvfs(ROOT, &s) != 0) { snprintf(out, n, "null"); return; }
    /* df -Pm округлює вгору */
    unsigned long long b = (unsigned long long)s.f_bavail * s.f_frsize;
    snprintf(out, n, "%llu", (b + 1048575) / 1048576);
}

/* ping до api: «<rtt> <jitter> <loss>», або «null null 100», як net_metrics. */
static void net_metrics(char *ping, char *jit, char *loss, size_t n) {
    char out[4096];
    char *argv[] = { "ping", "-c", "5", "-w", "10", (char *)PING_HOST, NULL };
    int rc = run_capture(argv, NULL, 15, out, sizeof out);
    snprintf(ping, n, "null"); snprintf(jit, n, "null"); snprintf(loss, n, "100");
    if (rc != 0) return;
    char *p = strstr(out, "% packet loss");
    if (p) { char *s = p; while (s > out && s[-1] != ' ') s--; snprintf(loss, n, "%.*s", (int)(p - s), s); }
    else snprintf(loss, n, "0");
    p = strstr(out, "rtt "); if (!p) p = strstr(out, "round-trip ");
    if (p && (p = strchr(p, '='))) {
        double mn, avg, mx, md;
        if (sscanf(p + 1, " %lf/%lf/%lf/%lf", &mn, &avg, &mx, &md) == 4) {
            snprintf(ping, n, "%.1f", avg); snprintf(jit, n, "%.1f", md);
        }
    }
}

/* Кіоск: fps_avg і frames_total з його UNIX-сокета (telemetry.c), 5 с. */
static void kiosk_metrics(char *fps, char *frames, size_t n) {
    char slot[16] = "0", path[64], b[4096];
    snprintf(fps, n, "null"); snprintf(frames, n, "null");
    char sp[600]; snprintf(sp, sizeof sp, "%s/slot.kiosk", STATE);
    if (read_file(sp, slot, sizeof slot) > 0) { slot[strcspn(slot, "\r\n ")] = 0; if (!slot[0]) strcpy(slot, "0"); }
    snprintf(path, sizeof path, "/tmp/kiosk-%s.sock", slot);
    int s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (s < 0) return;
    struct sockaddr_un a = { .sun_family = AF_UNIX };
    snprintf(a.sun_path, sizeof a.sun_path, "%s", path);
    struct timeval tv = { 5, 0 };
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    if (connect(s, (struct sockaddr *)&a, sizeof a) != 0) { close(s); return; }
    size_t got = 0; time_t dl = time(NULL) + 5;
    while (got + 1 < sizeof b && time(NULL) <= dl) {
        ssize_t k = read(s, b + got, sizeof b - 1 - got);
        if (k <= 0) break;
        got += (size_t)k; b[got] = 0;
        if (strchr(b, '\n')) break;
    }
    close(s);
    b[got] = 0;
    char *nl = strchr(b, '\n'); if (nl) *nl = 0;
    if (!strstr(b, "fps")) return;
    char *p = strstr(b, "\"fps_avg\"");
    if (p) { p += 9; while (*p == ' ' || *p == ':') p++; size_t l = strspn(p, "0123456789."); if (l) snprintf(fps, n, "%.*s", (int)l, p); }
    p = strstr(b, "\"frames_total\"");
    if (p) { p += 14; while (*p == ' ' || *p == ':') p++; size_t l = strspn(p, "0123456789"); if (l) snprintf(frames, n, "%.*s", (int)l, p); }
}

/* Монітор через CEC (monitor_probe/monitor_cached/monitor_wake у скрипті). */
static void monitor_probe(char *on, char *src, size_t n) {
    if (have_cmd("cec-client")) {
        for (int t = 1; t <= 2 && !STOPPING; t++) {
            char out[16384];
            char *argv[] = { "cec-client", "-s", "-d", "1", NULL };
            run_capture(argv, "pow 0\n", 12, out, sizeof out);
            for (char *c = out; *c; c++) if (*c >= 'A' && *c <= 'Z') *c += 32;
            char *p = strstr(out, "power status:");
            if (p) {
                if (strstr(p, "power status: on")) { snprintf(on, n, "true"); snprintf(src, n, "cec"); return; }
                if (strstr(p, "standby")) { snprintf(on, n, "false"); snprintf(src, n, "cec"); return; }
            }
            if (t == 1) nap_ms(2000);
        }
        snprintf(on, n, "false"); snprintf(src, n, "cec-silent");
        return;
    }
    snprintf(on, n, "null"); snprintf(src, n, "none");
}
static int monitor_cached(char *on, char *src, size_t n) { /* → 1, якщо опит свіжий */
    char b[128]; time_t now = time(NULL);
    if (read_file(MON_CACHE, b, sizeof b) > 0) {
        long e = 0; char o[16], s[16];
        if (sscanf(b, "%ld %15s %15s", &e, o, s) == 3 && now - e < MONITOR_PROBE_S && now - e >= 0) {
            snprintf(on, n, "%s", o); snprintf(src, n, "%s", s); return 0;
        }
    }
    monitor_probe(on, src, n);
    char c[128]; snprintf(c, sizeof c, "%ld %s %s\n", (long)now, on, src);
    write_atomic(MON_CACHE, c);
    return 1;
}
static int monitor_wake(void) {
    if (!AUTOWAKE || !have_cmd("cec-client")) return 0;
    logf_("монітор у сні — вмикаємо через CEC");
    char *argv[] = { "cec-client", "-s", "-d", "1", NULL };
    run_capture(argv, "on 0\n", 12, NULL, 0);
    return 1;
}

/* Маршрут в інтернет: інтерфейс, через який ядро шле пакет до 1.1.1.1
 * (UDP connect нічого не відправляє — лише вибирає маршрут і адресу). */
static void uplink_metrics(char *ul, char *dbm, size_t n) {
    snprintf(ul, n, "null"); snprintf(dbm, n, "null");
    int s = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (s >= 0) {
        struct sockaddr_in d; memset(&d, 0, sizeof d);
        d.sin_family = AF_INET; d.sin_port = htons(53);
        inet_pton(AF_INET, "1.1.1.1", &d.sin_addr);
        struct sockaddr_in me; socklen_t ml = sizeof me;
        if (connect(s, (struct sockaddr *)&d, sizeof d) == 0 && getsockname(s, (struct sockaddr *)&me, &ml) == 0) {
            struct ifaddrs *ifs = NULL;
            if (getifaddrs(&ifs) == 0) {
                for (struct ifaddrs *i = ifs; i; i = i->ifa_next) {
                    if (!i->ifa_addr || i->ifa_addr->sa_family != AF_INET) continue;
                    if (((struct sockaddr_in *)i->ifa_addr)->sin_addr.s_addr != me.sin_addr.s_addr) continue;
                    if (!strncmp(i->ifa_name, "wlan", 4)) snprintf(ul, n, "\"wifi\"");
                    else if (!strncmp(i->ifa_name, "eth", 3) || !strncmp(i->ifa_name, "br", 2)) snprintf(ul, n, "\"lte\"");
                    break;
                }
                freeifaddrs(ifs);
            }
        }
        close(s);
    }
    char b[2048];
    if (read_file("/proc/net/wireless", b, sizeof b) > 0) {
        for (char *line = strtok(b, "\n"); line; line = strtok(NULL, "\n")) {
            char name[32], f3[32], f4[32];
            if (sscanf(line, " %31s %*s %31s %31s", name, f3, f4) == 3 && !strncmp(name, "wlan", 4) && name[strlen(name) - 1] == ':') {
                char v[16]; size_t k = 0;
                for (char *c = f4; *c && k + 1 < sizeof v; c++) if (*c != '.') v[k++] = *c;
                v[k] = 0;
                if (k) snprintf(dbm, n, "%s", v);
                break;
            }
        }
    }
}

static int mounted(const char *mnt) {
    static char b[65536]; char pat[600];
    if (read_file("/proc/mounts", b, sizeof b) <= 0) return 0;
    snprintf(pat, sizeof pat, " %s ", mnt);
    return strstr(b, pat) != NULL;
}
static int write_probe(const char *dir) {
    char p[700]; snprintf(p, sizeof p, "%s/.rw-probe", dir);
    int fd = open(p, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return 0;
    close(fd); unlink(p);
    return 1;
}
static void root_readonly(char *out, size_t n) {
    static char b[65536];
    if (read_file("/proc/mounts", b, sizeof b) > 0) {
        for (char *line = strtok(b, "\n"); line; line = strtok(NULL, "\n")) {
            char dev[256], mnt[256], fs[64], opt[512];
            if (sscanf(line, "%255s %255s %63s %511s", dev, mnt, fs, opt) == 4 && !strcmp(mnt, "/")) {
                char o[520]; snprintf(o, sizeof o, ",%s,", opt);
                if (strstr(o, ",ro,")) { snprintf(out, n, "true"); return; }
            }
        }
    }
    snprintf(out, n, write_probe(STATE) ? "false" : "true");
}

/* Найсвіжіший сегмент теки — останній за абеткою (імена — час у UTC). */
static int newest_mkv(const char *dir, char *out, size_t n) {
    DIR *d = opendir(dir); if (!d) return 0;
    char best[256] = ""; struct dirent *e;
    while ((e = readdir(d))) {
        size_t l = strlen(e->d_name);
        if (l > 4 && !strcmp(e->d_name + l - 4, ".mkv") && strcmp(e->d_name, best) > 0) snprintf(best, sizeof best, "%s", e->d_name);
    }
    closedir(d);
    if (!best[0]) return 0;
    snprintf(out, n, "%s/%s", dir, best);
    return 1;
}
static const char *video_ok(void) {
    if (access(CAM_ENV, F_OK) != 0) return "false";
    char p[700], fd[600]; int ok = 0;
    if (RAMD[0]) ok = newest_mkv(RAMD, p, sizeof p);
    if (!ok) { snprintf(fd, sizeof fd, "%s/video", BUF); ok = newest_mkv(fd, p, sizeof p); }
    if (!ok) return "false";
    struct stat st; if (stat(p, &st) != 0) return "false";
    return time(NULL) - st.st_mtime < 180 ? "true" : "false";
}
static const char *usb_ok(void) {
    if (!BUF[0]) return "null";
    if (!mounted(BUF)) return "false";
    return write_probe(BUF) ? "true" : "false";
}
/* Обидві перевірки флешки — у дочірньому процесі з дедлайном 15 с: мертва
 * USB-шина вішає звертання до /mnt/buf у ядрі назавжди (flash_probe у
 * скрипті). Завислого не вбити — нового не запускаємо, поки він живий. */
static pid_t FLASH_PID = 0;
static void flash_probe(char *video, char *usb, size_t n) {
    snprintf(video, n, "false"); snprintf(usb, n, "false");
    if (FLASH_PID > 0) {
        if (waitpid(FLASH_PID, NULL, WNOHANG) == 0) return;   /* досі висить */
        FLASH_PID = 0;
    }
    int p[2]; if (pipe2(p, O_CLOEXEC) != 0) return;
    pid_t pid = fork();
    if (pid < 0) { close(p[0]); close(p[1]); return; }
    if (pid == 0) {
        close(p[0]);
        char r[32]; snprintf(r, sizeof r, "%s %s\n", video_ok(), usb_ok());
        ssize_t w = write(p[1], r, strlen(r)); (void)w;
        _exit(0);
    }
    close(p[1]);
    char b[64] = ""; size_t got = 0; time_t dl = time(NULL) + 15;
    for (;;) {
        int left = (int)(dl - time(NULL)); if (left <= 0) break;
        struct pollfd pf = { p[0], POLLIN, 0 };
        int r = poll(&pf, 1, left * 1000);
        if (r < 0 && errno == EINTR) { if (STOPPING) break; continue; }
        if (r <= 0) break;
        ssize_t k = read(p[0], b + got, sizeof b - 1 - got);
        if (k <= 0) break;
        got += (size_t)k; b[got] = 0;
        if (strchr(b, '\n')) break;
    }
    close(p[0]);
    char v[16], u[16];
    if (strchr(b, '\n') && sscanf(b, "%15s %15s", v, u) == 2) {
        snprintf(video, n, "%s", v); snprintf(usb, n, "%s", u);
        waitpid(pid, NULL, 0);
    } else FLASH_PID = pid;   /* не вклався — флешка мертва, чекаємо, поки відвисне */
}

static void upload_metrics(char *kb, char *ok, char *at, char *lim, size_t n) {
    char f[600], b[256]; snprintf(f, sizeof f, "%s/upload.last", STATE);
    snprintf(kb, n, "null"); snprintf(ok, n, "null"); snprintf(at, n, "null"); snprintf(lim, n, "null");
    if (read_file(f, b, sizeof b) <= 0) return;
    long e; int k; double bytes, secs; char l[16];
    if (sscanf(b, "%ld %d %lf %lf %15s", &e, &k, &bytes, &secs, l) != 5) return;
    if (secs > 0) snprintf(kb, n, "%.1f", bytes / 1024 / secs); else snprintf(kb, n, "0");
    snprintf(ok, n, k == 1 ? "true" : "false");
    char iso[32]; iso_utc((time_t)e, iso, sizeof iso); snprintf(at, n, "\"%s\"", iso);
    snprintf(lim, n, "%s", l);
}
static void queue_metrics(char *qn, char *old, size_t n) {
    char f[600], b[128]; snprintf(f, sizeof f, "%s/upload.queue", STATE);
    snprintf(qn, n, "null"); snprintf(old, n, "null");
    if (read_file(f, b, sizeof b) <= 0) return;
    long c, e;
    if (sscanf(b, "%ld %ld", &c, &e) != 2) return;
    snprintf(qn, n, "%ld", c);
    if (c > 0 && e > 0) { char iso[32]; iso_utc((time_t)e, iso, sizeof iso); snprintf(old, n, "\"%s\"", iso); }
}

/* Стан потоку ядра, який бачить і головне коло (розділ «ядро» нижче). */
static pthread_mutex_t K_MU = PTHREAD_MUTEX_INITIALIZER;
static long K_COUNT = -1;               /* помилок від старту ядра; -1 — kmsg не читається */
static unsigned long long K_SENT;       /* найбільший seq, що дійшов до api */
static char K_LAST[200], K_TOKEN[1024];

static int sample_json(char *out, size_t n) {
    enum { M = 48 };   /* кожне значення метрики — до M байтів */
    char cpu[M], temp[M], mem[M], memt[M], up[M], disk[M], ping[M], jit[M], loss[M], fps[M], frames[M];
    char mon[M], msrc[M], video[M], usb[M], ul[M], dbm[M], rofs[M], kb[M], ok[M], at[M], lim[M], qn[M], qold[M], kerr[M];
    cpu_percent(cpu, sizeof cpu); temp_c(temp, sizeof temp); mem_mb(mem, memt, sizeof mem);
    snprintf(up, sizeof up, "%.0f", uptime_now()); disk_free_mb(disk, sizeof disk);
    net_metrics(ping, jit, loss, sizeof ping);
    kiosk_metrics(fps, frames, sizeof fps);
    int fresh = monitor_cached(mon, msrc, sizeof mon);
    const char *woke = "false";
    if (fresh && !strcmp(mon, "false") && !strcmp(msrc, "cec") && monitor_wake()) { woke = "true"; unlink(MON_CACHE); }
    flash_probe(video, usb, sizeof video);
    uplink_metrics(ul, dbm, sizeof ul);
    root_readonly(rofs, sizeof rofs);
    char rel[PATH_MAX] = "unknown", real[PATH_MAX];
    if (realpath(CURRENT_LINK, real)) { char *b = strrchr(real, '/'); snprintf(rel, sizeof rel, "%s", b ? b + 1 : real); }
    upload_metrics(kb, ok, at, lim, sizeof kb);
    queue_metrics(qn, qold, sizeof qn);
    pthread_mutex_lock(&K_MU); long kc = K_COUNT; pthread_mutex_unlock(&K_MU);
    if (kc < 0) snprintf(kerr, sizeof kerr, "null"); else snprintf(kerr, sizeof kerr, "%ld", kc);
    char now[32]; iso_utc(time(NULL), now, sizeof now);
    return snprintf(out, n,
        "{\"source\":\"pi\",\"measured_at\":\"%s\",\"idem_key\":\"pi:%s\",\"metrics\":{\"cpu\":%s,\"temp_c\":%s,\"mem_used_mb\":%s,\"mem_total_mb\":%s,\"uptime_s\":%s,\"disk_free_mb\":%s,\"ping_ms\":%s,\"jitter_ms\":%s,\"loss_pct\":%s,\"kiosk_fps\":%s,\"kiosk_frames\":%s,\"monitor_on\":%s,\"monitor_src\":\"%s\",\"monitor_woke\":%s,\"video_ok\":%s,\"root_ro\":%s,\"usb_ok\":%s,\"kernel_errors\":%s,\"upload_kb_s\":%s,\"upload_ok\":%s,\"upload_at\":%s,\"upload_limit_kb_s\":%s,\"upload_queue\":%s,\"upload_oldest\":%s,\"uplink\":%s,\"wifi_dbm\":%s,\"release\":\"%s\"}}",
        now, now, cpu, temp, mem, memt, up, disk, ping, jit, loss, fps, frames, mon, msrc, woke, video, rofs, usb, kerr,
        kb, ok, at, lim, qn, qold, ul, dbm, rel);
}

/* ── черга ────────────────────────────────────────────────────────────── */
/* Рядки черги в памʼяті: файл на картці — джерело правди, переписуємо
 * атомарно після кожної зміни (як скрипт: tail > .rest && mv). */
typedef struct { char **l; int n, cap; } Lines;
static void lines_free(Lines *q) { for (int i = 0; i < q->n; i++) free(q->l[i]); free(q->l); q->l = NULL; q->n = q->cap = 0; }
static void lines_push(Lines *q, const char *s) {
    if (q->n == q->cap) { q->cap = q->cap ? q->cap * 2 : 64; q->l = realloc(q->l, sizeof(char *) * q->cap); }
    q->l[q->n++] = strdup(s);
}
static void queue_load(Lines *q) {
    lines_free(q);
    FILE *f = fopen(QUEUE, "r"); if (!f) return;
    char *line = NULL; size_t cap = 0; ssize_t k;
    while ((k = getline(&line, &cap, f)) > 0) {
        while (k && (line[k - 1] == '\n' || line[k - 1] == '\r')) line[--k] = 0;
        if (k) lines_push(q, line);
    }
    free(line); fclose(f);
}
static int queue_save(Lines *q, int from) {
    char tmp[700]; snprintf(tmp, sizeof tmp, "%s.tmp", QUEUE);
    FILE *f = fopen(tmp, "w"); if (!f) return -1;
    for (int i = from; i < q->n; i++) { fputs(q->l[i], f); fputc('\n', f); }
    if (fclose(f) != 0) { unlink(tmp); return -1; }
    return rename(tmp, QUEUE);
}
static int queue_push(const char *s) {
    size_t l = strlen(s);
    if (l < 2 || s[0] != '{' || s[l - 1] != '}') { logf_("проба не схожа на JSON — у чергу не кладу"); return -1; }
    FILE *f = fopen(QUEUE, "a"); if (!f) return -1;
    fputs(s, f); fputc('\n', f); fclose(f);
    Lines q = {0}; queue_load(&q);
    if (q.n > QUEUE_MAX) queue_save(&q, q.n - QUEUE_MAX);
    lines_free(&q);
    return 0;
}

/* Перештампування останніх n проб після стрибка годинника (queue_restamp):
 * справжній час = зараз − (аптайм зараз − аптайм проби). */
static void queue_restamp(int n) {
    Lines q = {0}; queue_load(&q);
    if (!q.n) { lines_free(&q); return; }
    if (n > q.n) n = q.n;
    time_t now = time(NULL); double up = uptime_now();
    for (int i = q.n - n; i < q.n; i++) {
        char *u = strstr(q.l[i], "\"uptime_s\":");
        char *m = strstr(q.l[i], "\"measured_at\":\"");
        if (!u || !m) continue;
        long su = atol(u + 11);
        if (u[11] < '0' || u[11] > '9') continue;
        char iso[32]; iso_utc(now - (time_t)(up - su), iso, sizeof iso);
        char *v = m + 15, *e = strchr(v, '"'); if (!e) continue;
        size_t pre = (size_t)(v - q.l[i]);
        char *nl = malloc(strlen(q.l[i]) + 40);
        sprintf(nl, "%.*s%s%s", (int)pre, q.l[i], iso, e);
        free(q.l[i]); q.l[i] = nl;
    }
    if (queue_save(&q, 0) == 0) logf_("годинник стрибнув — перештампував %d проб за uptime", n);
    lines_free(&q);
}

static CURL *API_H;
static char TOKEN[1024];
static int read_token(void) {
    char b[sizeof TOKEN]; int k = read_file(TOKEN_FILE, b, sizeof b);
    if (k <= 0) return -1;
    while (k && (b[k - 1] == '\n' || b[k - 1] == '\r' || b[k - 1] == ' ')) b[--k] = 0;
    snprintf(TOKEN, sizeof TOKEN, "%s", b);
    return k ? 0 : -1;
}
static size_t sink(char *d, size_t s, size_t n, void *u) { (void)d; (void)u; return s * n; }
static int xfer_abort(void *u, curl_off_t a, curl_off_t b, curl_off_t c, curl_off_t d) { (void)u; (void)a; (void)b; (void)c; (void)d; return STOPPING; }

static long post_batch(const char *body) {
    char url[1024], auth[1200];
    snprintf(url, sizeof url, "%s/points/%s/telemetry", API, POINT);
    snprintf(auth, sizeof auth, "authorization: Bearer %s", TOKEN);
    struct curl_slist *h = curl_slist_append(NULL, auth);
    h = curl_slist_append(h, "content-type: application/json");
    curl_easy_reset(API_H);   /* зʼєднання й TLS-сесія лишаються в кеші */
    curl_easy_setopt(API_H, CURLOPT_URL, url);
    curl_easy_setopt(API_H, CURLOPT_HTTPHEADER, h);
    curl_easy_setopt(API_H, CURLOPT_POSTFIELDS, body);
    curl_easy_setopt(API_H, CURLOPT_TIMEOUT, 20L);
    curl_easy_setopt(API_H, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(API_H, CURLOPT_TCP_KEEPALIVE, 1L);
    curl_easy_setopt(API_H, CURLOPT_WRITEFUNCTION, sink);
    curl_easy_setopt(API_H, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(API_H, CURLOPT_XFERINFOFUNCTION, xfer_abort);
    CURLcode rc = curl_easy_perform(API_H);
    long code = 0; curl_easy_getinfo(API_H, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(h);
    return rc == CURLE_OK ? code : 0;
}

/* send_queue: пачками по BATCH_MAX; 2xx — пачку з черги геть; 401/403 —
 * чекаємо; 400 — викидаємо лише цю пачку; решта — лишаємо все. */
static int send_queue(void) {
    Lines q = {0}; queue_load(&q);
    if (!q.n) { lines_free(&q); return 0; }
    if (read_token() != 0) { lines_free(&q); return -1; }
    int sent = 0, from = 0, ret = 0;
    while (from < q.n && !STOPPING) {
        int cnt = q.n - from; if (cnt > BATCH_MAX) cnt = BATCH_MAX;
        size_t len = 16;
        for (int i = 0; i < cnt; i++) len += strlen(q.l[from + i]) + 1;
        char *body = malloc(len), *p = body;
        p += sprintf(p, "{\"samples\":[");
        for (int i = 0; i < cnt; i++) p += sprintf(p, "%s%s", i ? "," : "", q.l[from + i]);
        sprintf(p, "]}");
        long code = post_batch(body);
        free(body);
        if (code >= 200 && code < 300) { from += cnt; sent += cnt; queue_save(&q, from); continue; }
        if (code == 401 || code == 403) { logf_("токен точки не приймають (%ld) — телеметрія чекає", code); ret = -1; break; }
        if (code == 400) { from += cnt; queue_save(&q, from); logf_("сервер не прийняв пачку (400) — викидаю %d проб, решту лишаю", cnt); continue; }
        if (sent > 0) logf_("надіслано проб: %d, решта лишається в черзі", sent);
        char c[8]; snprintf(c, sizeof c, "%03ld", code);
        logf_("не вийшло надіслати (%s), лишаємо в черзі", c);
        lines_free(&q);
        return -1;
    }
    if (ret == 0 && sent > 0) logf_("надіслано проб: %d", sent);
    lines_free(&q);
    return ret;
}

/* ── ядро: помилки з /dev/kmsg — окремим потоком (17.10.2026) ─────────────
 * 13.10 і 16.10.2026 малина вмирала однаково: за пів хвилини після
 * останньої доброї проби сама закривала тунель, і далі — тиша до
 * блекауту. 13.10 лог ядра спіймали наживо (`mmcblk0: timed out sending
 * r/w cmd` — SD-картка перестала відповідати), 16.10 — ні: ядро живе й
 * годує watchdog, журнал — у RAM, а прочитати його не було кому
 * (raspberry-pi.md, «Помилки ядра в телеметрії»).
 *
 * Тому потік читає /dev/kmsg і помилку, щойно вона з'явилась, шле в api
 * окремою пробою (source "kernel"), не чекаючи хвилинного кола. Окремим
 * потоком, бо головне коло саме ходить на картку (пульс, черга) і на мертвій
 * картці стає першим. Потік картки не торкається: /dev/kmsg — це ядро,
 * адреса api й кореневі сертифікати — у памʼяті з самого старту (інакше curl
 * читав би /etc на кожне нове з'єднання), невідправлене чекає в памʼяті, а
 * не в черзі на картці. Лог і state/ пише лише головне коло (kernel_tick).
 *
 * Помилка — це ядерне повідомлення рівня err і вище, попередження зі
 * словами з K_WARN і звичайне повідомлення зі словами з K_NOTE: так ядро
 * пише про біду з SD, з USB (на Pi 1 на ній і Ethernet, і Wi-Fi, і флешка)
 * і з памʼяттю. Шум, якщо з'явиться, — відсіювати тут, побачивши справжні
 * рядки в адмінці.
 *
 * «mmc» у K_NOTE — з 18.10.2026: того дня картка відпала на 8-й хвилині, і
 * між помилками EXT4 ядро знову ініціалізувало її («host does not support
 * reading read-only switch» — рядок старту картки), а рядки про те, що
 * картку втрачено й знайдено наново («card … removed», «new … card»,
 * «mmcblk…»), — рівня info, і фільтр їх з'їв. Саме вони відрізняють
 * «картка відпала з шини» від CRC-помилок 13.10. «WARNING:» — заголовок
 * ядерного попередження зі стеком: без нього з усього стеку доходив лише
 * «Modules linked in» (і то через «rt2800» у списку модулів). */
static const char *const K_WARN[] = {
    "mmc", "I/O error", "EXT4-fs", "usb", "USB", "dwc_otg", "smsc95xx", "rt2800",
    "voltage", "blocked for more than", "Out of memory", "Killed process", "WARNING:", NULL };
static const char *const K_NOTE[] = { "USB disconnect", "reset full-speed", "reset high-speed", "timed out", "mmc", NULL };
static int k_has(const char *msg, const char *const words[]) {
    for (int i = 0; words[i]; i++) if (strstr(msg, words[i])) return 1;
    return 0;
}
static int k_wanted(int fac, int lvl, const char *msg) {
    if (fac != 0) return 0;   /* лише саме ядро, а не те, що пишуть у kmsg процеси */
    if (lvl <= 3) return 1;
    if (lvl == 4) return k_has(msg, K_WARN);
    if (lvl <= 6) return k_has(msg, K_NOTE);
    return 0;
}

#define K_LINES_MAX 40
typedef struct { unsigned long long seq, ts_us; int lvl; char msg[200]; } KLine;
static KLine K_PEND[K_LINES_MAX];   /* ще не дійшли до api — їх чіпає лише потік */
static int K_PEND_N;
static long K_DROPPED;
static unsigned long long K_SKIP;   /* seq, що дійшов до api ще до цього запуску */
static char K_BOOT[40], KSENT_FILE[600];
static int KMSG_FD = -1, KMSG_FILE = 0;
static CURL *K_H;

/* Адреса api — заздалегідь: getaddrinfo на кожен запит читає /etc/hosts.
 * Не вийшло (мережі ще немає) — потік ходить зі звичайним DNS. */
static char API_HOST[256];
static int API_PORT;
static struct curl_slist *K_RESOLVE;
static void k_resolve(void) {
    struct addrinfo hints = {0}, *res = NULL;
    hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM;
    if (!API_HOST[0] || getaddrinfo(API_HOST, NULL, &hints, &res) != 0 || !res) return;
    char ip[INET_ADDRSTRLEN], entry[400];
    inet_ntop(AF_INET, &((struct sockaddr_in *)res->ai_addr)->sin_addr, ip, sizeof ip);
    freeaddrinfo(res);
    snprintf(entry, sizeof entry, "%s:%d:%s", API_HOST, API_PORT, ip);
    curl_slist_free_all(K_RESOLVE);
    K_RESOLVE = curl_slist_append(NULL, entry);
}

/* Кореневі сертифікати — теж у памʼять один раз. Функції OpenSSL беремо з
 * уже завантаженої libcurl-ом бібліотеки за soname, як ssl_locks.c:
 * заголовків OpenSSL у збиральному контейнері немає. Не вийшло — потік
 * ходить зі звичайними налаштуваннями curl, як і головне коло. */
typedef void *(*bio_mem_fn)(const void *, int);
typedef void *(*pem_x509_fn)(void *, void *, void *, void *);
typedef int (*bio_free_fn)(void *);
typedef void *(*ctx_store_fn)(void *);
typedef int (*store_add_fn)(void *, void *);
typedef void (*err_clear_fn)(void);
static ctx_store_fn CTX_STORE;
static store_add_fn STORE_ADD;
static err_clear_fn ERR_CLEAR;
static void **CA;
static int CA_N;
static void *k_lib(const char *const names[]) {
    for (int i = 0; names[i]; i++) { void *h = dlopen(names[i], RTLD_NOW | RTLD_NOLOAD); if (h) return h; }
    return NULL;
}
static void ca_load(const char *path) {
    static const char *const CRYPTO[] = { "libcrypto.so.1.0.2", "libcrypto.so.1.1", "libcrypto.so.3", NULL };
    static const char *const SSLLIB[] = { "libssl.so.1.0.2", "libssl.so.1.1", "libssl.so.3", NULL };
    void *c = k_lib(CRYPTO), *s = k_lib(SSLLIB);
    if (!c || !s) return;
    bio_mem_fn bio_mem = (bio_mem_fn)dlsym(c, "BIO_new_mem_buf");
    pem_x509_fn pem = (pem_x509_fn)dlsym(c, "PEM_read_bio_X509");
    bio_free_fn bio_free = (bio_free_fn)dlsym(c, "BIO_free");
    STORE_ADD = (store_add_fn)dlsym(c, "X509_STORE_add_cert");
    ERR_CLEAR = (err_clear_fn)dlsym(c, "ERR_clear_error");
    CTX_STORE = (ctx_store_fn)dlsym(s, "SSL_CTX_get_cert_store");
    if (!bio_mem || !pem || !bio_free || !STORE_ADD || !ERR_CLEAR || !CTX_STORE) return;
    struct stat st;
    if (stat(path, &st) != 0 || st.st_size <= 0 || st.st_size > (4 << 20)) return;
    char *text = malloc((size_t)st.st_size + 1);
    if (!text) return;
    int got = read_file(path, text, (size_t)st.st_size + 1);
    void *bio = got > 0 ? bio_mem(text, got) : NULL;
    int cap = 0; void *x;
    while (bio && (x = pem(bio, NULL, NULL, NULL))) {
        if (CA_N == cap) {
            void **more = realloc(CA, sizeof(void *) * (size_t)(cap ? cap * 2 : 128));
            if (!more) break;
            CA = more; cap = cap ? cap * 2 : 128;
        }
        CA[CA_N++] = x;
    }
    if (bio) bio_free(bio);
    free(text);
    ERR_CLEAR();   /* кінець PEM лишає в черзі помилок OpenSSL «no start line» */
}
static CURLcode ca_ctx(CURL *h, void *ctx, void *u) {
    (void)h; (void)u;
    void *store = CTX_STORE(ctx);
    for (int i = 0; i < CA_N; i++) STORE_ADD(store, CA[i]);
    ERR_CLEAR();
    return CURLE_OK;
}

/* Один запис kmsg: «prio,seq,ts_us,flags[,…];текст»; рядки « KEY=value»
 * після нього (словник пристрою) пропускаємо. → 1, якщо нова помилка. */
static int k_line(char *line) {
    if (!line[0] || line[0] == ' ') return 0;
    char *semi = strchr(line, ';');
    if (!semi) return 0;
    *semi = 0;
    unsigned long prio; unsigned long long seq, ts;
    if (sscanf(line, "%lu,%llu,%llu", &prio, &seq, &ts) != 3) return 0;
    const char *msg = semi + 1;
    if (!k_wanted((int)(prio >> 3), (int)(prio & 7), msg)) return 0;
    pthread_mutex_lock(&K_MU);
    K_COUNT++;
    snprintf(K_LAST, sizeof K_LAST, "%s", msg);
    pthread_mutex_unlock(&K_MU);
    if (seq <= K_SKIP) return 0;
    if (K_PEND_N < K_LINES_MAX) {
        KLine *k = &K_PEND[K_PEND_N++];
        k->seq = seq; k->ts_us = ts; k->lvl = (int)(prio & 7);
        snprintf(k->msg, sizeof k->msg, "%s", msg);
    } else K_DROPPED++;   /* перші найцінніші: з них видно, з чого почалось */
    return 1;
}

/* Усе, що ядро вже має. З /dev/kmsg один read — рівно один запис; зі
 * звичайного файла (перевірка на ПК, TELEMETRY_KMSG) — скільки влізло, тож
 * хвіст без \n чекає наступного read. → скільки нових помилок. */
static char K_BUF[16384];
static size_t K_HELD;
static int k_drain(void) {
    int fresh = 0;
    for (;;) {
        ssize_t k = read(KMSG_FD, K_BUF + K_HELD, sizeof K_BUF - 1 - K_HELD);
        /* EPIPE — найстаріші записи вже затерто; наступний read дасть живі. */
        if (k < 0 && (errno == EINTR || errno == EPIPE)) continue;
        if (k <= 0) break;
        K_HELD += (size_t)k; K_BUF[K_HELD] = 0;
        char *p = K_BUF, *nl;
        while ((nl = strchr(p, '\n'))) { *nl = 0; fresh += k_line(p); p = nl + 1; }
        K_HELD = strlen(p);
        memmove(K_BUF, p, K_HELD);
        if (K_HELD >= sizeof K_BUF - 1) K_HELD = 0;   /* рядок довший за буфер — геть */
    }
    return fresh;
}

static void json_str(char *out, size_t n, const char *s) {   /* рядок для JSON, без лапок */
    size_t o = 0;
    for (; *s && o + 7 < n; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = (char)c; }
        else if (c < 0x20) o += (size_t)snprintf(out + o, n - o, "\\u%04x", c);
        else out[o++] = (char)c;
    }
    out[o] = 0;
}

/* Невідправлені рядки — однією пробою. → 0, якщо їх більше слати не треба. */
static int k_send(void) {
    char tok[sizeof K_TOKEN];
    pthread_mutex_lock(&K_MU);
    snprintf(tok, sizeof tok, "%s", K_TOKEN);
    long count = K_COUNT;
    pthread_mutex_unlock(&K_MU);
    if (!tok[0]) return -1;
    static char body[K_LINES_MAX * 512 + 1024];
    char now[32]; iso_utc(time(NULL), now, sizeof now);
    size_t o = (size_t)snprintf(body, sizeof body,
        "{\"samples\":[{\"source\":\"kernel\",\"measured_at\":\"%s\",\"idem_key\":\"kernel:%.8s:%llu\","
        "\"metrics\":{\"uptime_s\":%.0f,\"boot_id\":\"%s\",\"errors_since_boot\":%ld,\"dropped\":%ld,\"lines\":[",
        now, K_BOOT, K_PEND[0].seq, uptime_now(), K_BOOT, count, K_DROPPED);
    for (int i = 0; i < K_PEND_N && o < sizeof body - 600; i++) {
        char esc[420]; json_str(esc, sizeof esc, K_PEND[i].msg);
        o += (size_t)snprintf(body + o, sizeof body - o, "%s{\"t\":%.3f,\"lvl\":%d,\"seq\":%llu,\"msg\":\"%s\"}",
                              i ? "," : "", K_PEND[i].ts_us / 1e6, K_PEND[i].lvl, K_PEND[i].seq, esc);
    }
    snprintf(body + o, sizeof body - o, "]}}]}");

    char url[1024], auth[1200];
    snprintf(url, sizeof url, "%s/points/%s/telemetry", API, POINT);
    snprintf(auth, sizeof auth, "authorization: Bearer %s", tok);
    struct curl_slist *h = curl_slist_append(NULL, auth);
    h = curl_slist_append(h, "content-type: application/json");
    curl_easy_reset(K_H);
    curl_easy_setopt(K_H, CURLOPT_URL, url);
    curl_easy_setopt(K_H, CURLOPT_HTTPHEADER, h);
    curl_easy_setopt(K_H, CURLOPT_POSTFIELDS, body);
    curl_easy_setopt(K_H, CURLOPT_TIMEOUT, 20L);
    curl_easy_setopt(K_H, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(K_H, CURLOPT_WRITEFUNCTION, sink);
    if (K_RESOLVE) curl_easy_setopt(K_H, CURLOPT_RESOLVE, K_RESOLVE);
    if (CA_N) {
        curl_easy_setopt(K_H, CURLOPT_CAINFO, NULL);
        curl_easy_setopt(K_H, CURLOPT_CAPATH, NULL);
        curl_easy_setopt(K_H, CURLOPT_SSL_CTX_FUNCTION, ca_ctx);
    }
    CURLcode rc = curl_easy_perform(K_H);
    long code = 0; curl_easy_getinfo(K_H, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(h);
    if (rc == CURLE_COULDNT_CONNECT) k_resolve();   /* раптом api переїхав на іншу адресу */
    if (rc != CURLE_OK) return -1;
    if (code >= 200 && code < 300) {
        pthread_mutex_lock(&K_MU); K_SENT = K_PEND[K_PEND_N - 1].seq; pthread_mutex_unlock(&K_MU);
        return 0;
    }
    return code == 400 ? 0 : -1;   /* 400 — api цю пробу не візьме, повтор не допоможе */
}

static long long mono_ms(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000LL + t.tv_nsec / 1000000;
}
static void *k_main(void *arg) {
    (void)arg;
    long long due = 0, last = -100000;
    for (;;) {
        int fresh = k_drain();
        long long now = mono_ms();
        /* Нова помилка — шлемо за секунду (за нею часто йде ціла низка),
         * але не частіше ніж раз на 5 с; не вийшло — повтор за 30 с. */
        if (fresh && K_PEND_N) {
            long long t = now + 1000;
            if (t < last + 5000) t = last + 5000;
            if (!due || t < due) due = t;
        }
        if (due && now >= due) {
            last = now;
            if (k_send() == 0) { K_PEND_N = 0; K_DROPPED = 0; due = 0; }
            else due = now + 30000;
            continue;
        }
        if (KMSG_FILE) { struct timespec ts = { 0, 200000000L }; nanosleep(&ts, NULL); continue; }   /* poll на файлі завжди «готовий» */
        struct pollfd p = { KMSG_FD, POLLIN, 0 };
        poll(&p, 1, due ? (int)(due - now) : 60000);
    }
    return NULL;
}

static void kernel_start(void) {
    const char *path = env_or("TELEMETRY_KMSG", "/dev/kmsg");
    snprintf(KSENT_FILE, sizeof KSENT_FILE, "%s/kmsg.sent", STATE);
    KMSG_FD = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (KMSG_FD < 0) { logf_("ядро: %s не читається (%s) — помилок ядра в пробах не буде", path, strerror(errno)); return; }
    struct stat st;
    KMSG_FILE = fstat(KMSG_FD, &st) == 0 && S_ISREG(st.st_mode);
    if (read_file("/proc/sys/kernel/random/boot_id", K_BOOT, sizeof K_BOOT) > 0) K_BOOT[strcspn(K_BOOT, "\r\n")] = 0;
    /* Що вже дійшло до api в цьому ж завантаженні (перезапуск компонента з
     * релізом) — вдруге не шлемо, хоч у kmsg воно й лишилось. */
    char b[128], boot[40]; unsigned long long seq;
    if (read_file(KSENT_FILE, b, sizeof b) > 0 && sscanf(b, "%39s %llu", boot, &seq) == 2 && !strcmp(boot, K_BOOT))
        K_SKIP = K_SENT = seq;
    const char *p = strstr(API, "://"); p = p ? p + 3 : API;
    size_t l = strcspn(p, ":/");
    snprintf(API_HOST, sizeof API_HOST, "%.*s", (int)l, p);
    API_PORT = p[l] == ':' ? atoi(p + l + 1) : !strncmp(API, "https", 5) ? 443 : 80;
    k_resolve();
    if (!strncmp(API, "https", 5)) ca_load(env_or("TELEMETRY_CA_FILE", "/etc/ssl/certs/ca-certificates.crt"));
    K_H = curl_easy_init();
    if (read_token() == 0) snprintf(K_TOKEN, sizeof K_TOKEN, "%s", TOKEN);
    K_COUNT = 0;
    /* SIGTERM — головному колу: інакше сигнал міг би дістатись потоку, і
     * головне коло спало б далі, поки супервізор не добʼє його SIGKILL. */
    sigset_t term, old; sigemptyset(&term); sigaddset(&term, SIGTERM); sigaddset(&term, SIGINT);
    pthread_sigmask(SIG_BLOCK, &term, &old);
    pthread_t t; pthread_attr_t a;
    pthread_attr_init(&a); pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
    int rc = pthread_create(&t, &a, k_main, NULL);
    pthread_attr_destroy(&a);
    pthread_sigmask(SIG_SETMASK, &old, NULL);
    if (rc != 0) { K_COUNT = -1; logf_("ядро: потік не стартував — помилок ядра в пробах не буде"); return; }
    logf_("ядро: стежу за %s, %s", path, CA_N ? "адреса й сертифікати api — у памʼяті" : "сертифікати api — звичайні, з /etc");
}

/* Головне коло — за потік: свіжий ключ точки йому, позначка «що вже дійшло»
 * на картку й рядок у лог. Потік сам на картку не ходить. */
static void kernel_tick(void) {
    static unsigned long long written;
    static long logged;
    if (KMSG_FD < 0) return;
    char last[sizeof K_LAST];
    pthread_mutex_lock(&K_MU);
    if (TOKEN[0]) snprintf(K_TOKEN, sizeof K_TOKEN, "%s", TOKEN);
    unsigned long long sent = K_SENT; long count = K_COUNT;
    snprintf(last, sizeof last, "%s", K_LAST);
    pthread_mutex_unlock(&K_MU);
    if (sent && sent != written) {
        char b[96]; snprintf(b, sizeof b, "%s %llu\n", K_BOOT, sent);
        write_atomic(KSENT_FILE, b); written = sent;
    }
    if (count > logged) { logf_("ядро: помилок від старту %ld (+%ld), остання: %s", count, count - logged, last); logged = count; }
}

/* NTP-синхронізація — те саме, що «NTP synchronized: yes» у timedatectl
 * (systemd бере його з adjtimex), без D-Bus і без процесу. */
static int clock_ntp_ok(void) {
    struct timex tx = {0};
    return adjtimex(&tx) >= 0 && !(tx.status & STA_UNSYNC);
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
    PING_HOST = env_or("TELEMETRY_PING_HOST", "api.extrovert.cafe");
    BUF = getenv("RECORDER_BUF"); if (!BUF) BUF = "/mnt/buf";
    RAMD = getenv("RECORDER_RAM"); if (!RAMD) RAMD = "/dev/shm/extrovert-video";
    PERIOD = env_int("TELEMETRY_PERIOD_S", 60);
    MONITOR_PROBE_S = env_int("TELEMETRY_MONITOR_PROBE_S", 300);
    AUTOWAKE = env_int("MONITOR_AUTOWAKE", 1) == 1;
    snprintf(QUEUE, sizeof QUEUE, "%s/telemetry.queue", STATE);
    snprintf(BEAT, sizeof BEAT, "%s/beat.telemetry", STATE);
    snprintf(MON_CACHE, sizeof MON_CACHE, "%s/monitor.last", STATE);
    snprintf(CAM_ENV, sizeof CAM_ENV, "%s/config/camera.env", ROOT);
    snprintf(CURRENT_LINK, sizeof CURRENT_LINK, "%s/current", ROOT);

    /* Нагляд, а не робота точки: nice 10 і ionice idle, як у скрипті. */
    if (setpriority(PRIO_PROCESS, 0, 10) != 0) {}
    syscall(SYS_ioprio_set, 1, 0, 3 << 13);
    struct sigaction sa = {0}; sa.sa_handler = on_term;
    sigaction(SIGTERM, &sa, NULL); sigaction(SIGINT, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    curl_global_init(CURL_GLOBAL_DEFAULT);
    /* До потоку ядра: у TLS тепер ходять двоє (ssl_locks.c). */
    if (ssl_locks_init() < 0) logf_("OpenSSL 1.0.2 є, а замки поставити не вдалось");
    API_H = curl_easy_init();
    mkdir(STATE, 0755);
    logf_("телеметрія піднялась (C): кожні %dс у %s", PERIOD, API);
    kernel_start();

    int queued_this_boot = 0;
    time_t prev_epoch = time(NULL); double prev_up = uptime_now();
    static char sample[8192];
    while (!STOPPING) {
        time_t started = time(NULL);
        write_atomic(BEAT, "");
        /* Стрибок годинника: еталон — uptime (див. telemetry.sh). */
        double up_now = uptime_now(); time_t ep_now = time(NULL);
        long drift = (long)(ep_now - (prev_epoch + (time_t)(up_now - prev_up)));
        if (drift < 0) drift = -drift;
        if (queued_this_boot > 0 && clock_ntp_ok()) {
            if (drift >= 5) queue_restamp(queued_this_boot);
            queued_this_boot = 0;
        }
        prev_epoch = ep_now; prev_up = up_now;

        if (access(TOKEN_FILE, F_OK) == 0) {
            sample_json(sample, sizeof sample);
            if (queue_push(sample) == 0 && !clock_ntp_ok()) queued_this_boot++;
            send_queue();
        } else logf_("немає %s — пропускаємо прохід", TOKEN_FILE);
        kernel_tick();

        long left = PERIOD - (long)(time(NULL) - started);
        if (left < 5) left = 5;
        if (!STOPPING) nap_ms(left * 1000);
    }
    logf_("зупиняємось");
    kernel_tick();   /* позначка «що вже дійшло» — щоб наступний запуск не слав його вдруге */
    curl_easy_cleanup(API_H);
    curl_global_cleanup();
    return 0;
}
