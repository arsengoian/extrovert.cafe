#include "telemetry.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <errno.h>

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

void telemetry_init(telemetry_t *t, const char *sock_path) {
    memset(t, 0, sizeof(*t));
    t->started_at = now_s();
    t->last_frame_at = t->started_at;
    t->sock_fd = -1;

    if (!sock_path || !sock_path[0]) return;

    unlink(sock_path);   /* попередній запуск міг лишити файл сокета */
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK, 0);
    if (fd < 0) { perror("telemetry: socket"); return; }

    struct sockaddr_un addr = {0};
    addr.sun_family = AF_UNIX;
    snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", sock_path);

    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("telemetry: bind"); close(fd); return;
    }
    if (listen(fd, 4) < 0) {
        perror("telemetry: listen"); close(fd); return;
    }
    chmod(sock_path, 0666);   /* локальний сокет для налагодження, не для довіри */
    t->sock_fd = fd;
    fprintf(stderr, "telemetry: слухаю %s\n", sock_path);
}

void telemetry_frame(telemetry_t *t) {
    double t_now = now_s();
    double dt_ms = (t_now - t->last_frame_at) * 1000.0;
    t->last_frame_at = t_now;

    t->frame_ms[t->ring_pos] = dt_ms;
    t->ring_pos = (t->ring_pos + 1) % TELEMETRY_RING;
    if (t->ring_count < TELEMETRY_RING) t->ring_count++;
    t->frames_total++;
}

static void write_stats(telemetry_t *t, int fd) {
    double sum = 0, worst = 0, best = 1e9;
    /* fps за останню секунду (а не за весь ring, щоб число реагувало
     * швидко на щойно змінене навантаження — так само як HUD у app.js
     * рахував fps за вікна по 1000 мс). */
    double window_ms = 0;
    int window_frames = 0;
    for (int i = 0; i < t->ring_count; i++) {
        int idx = (t->ring_pos - 1 - i + TELEMETRY_RING) % TELEMETRY_RING;
        double v = t->frame_ms[idx];
        sum += v;
        if (v > worst) worst = v;
        if (v < best) best = v;
        if (window_ms < 1000.0) { window_ms += v; window_frames++; }
    }
    double avg_ms = t->ring_count ? sum / t->ring_count : 0;
    double fps_1s = window_ms > 0 ? window_frames * 1000.0 / window_ms : 0;
    double fps_avg = avg_ms > 0 ? 1000.0 / avg_ms : 0;
    double uptime = now_s() - t->started_at;

    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{\"fps_1s\":%.2f,\"fps_avg\":%.2f,\"frame_ms_avg\":%.2f,"
        "\"frame_ms_worst\":%.2f,\"frame_ms_best\":%.2f,"
        "\"frames_total\":%lu,\"uptime_s\":%.1f,\"samples\":%d}\n",
        fps_1s, fps_avg, avg_ms, worst, best, t->frames_total, uptime, t->ring_count);
    if (n > 0) {
        ssize_t w = write(fd, buf, (size_t)n);
        (void)w;   /* найгірше — клієнт не дочекається байта; не критично */
    }
}

void telemetry_poll(telemetry_t *t) {
    if (t->sock_fd < 0) return;
    for (;;) {
        int cfd = accept(t->sock_fd, NULL, NULL);
        if (cfd < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK)
                perror("telemetry: accept");
            return;
        }
        write_stats(t, cfd);
        close(cfd);
    }
}

void telemetry_close(telemetry_t *t) {
    if (t->sock_fd >= 0) close(t->sock_fd);
    t->sock_fd = -1;
}
