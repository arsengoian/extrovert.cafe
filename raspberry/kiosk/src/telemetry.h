/* telemetry.h — точний fps «з памʼяті процесу», а не оцінка ззовні.
 *
 * Раніше fps на Chromium ми діставали через CDP requestAnimationFrame —
 * зовнішній інструмент, що сам тримає ноутбук з тунелем. Тут лічильник
 * живе в самому процесі: кожен platform_swap() дописує тривалість кадру
 * в кільцевий буфер, а невеликий UNIX-сокет віддає зняту статистику будь-
 * кому, хто підключиться — без залежності від Chrome DevTools Protocol.
 */
#ifndef POS_NATIVE_TELEMETRY_H
#define POS_NATIVE_TELEMETRY_H

#include <stddef.h>

#define TELEMETRY_RING 600   /* 10 c при 60 fps — досить для миттєвих і середніх цифр */

typedef struct {
    double frame_ms[TELEMETRY_RING];
    int ring_pos;
    int ring_count;
    unsigned long frames_total;
    double started_at;         /* монотонний час старту, для uptime */
    double last_frame_at;
    int sock_fd;                /* слухаючий UNIX-сокет, -1 якщо вимкнено */
} telemetry_t;

/* path — напр. /tmp/kiosk.sock. NULL/"" — телеметрія працює, але без
 * сокета (лічильник у памʼяті все одно ведеться, знадобиться для HUD). */
void telemetry_init(telemetry_t *t, const char *sock_path);

/* Викликати рівно раз на кадр, одразу після platform_swap(). */
void telemetry_frame(telemetry_t *t);

/* Неблокуюча перевірка: чи є клієнт, що чекає на статистику; якщо так —
 * пише один рядок JSON і закриває зʼєднання. Викликати раз на кадр —
 * дешевше за окремий потік, і не потрібен м'ютекс. */
void telemetry_poll(telemetry_t *t);

void telemetry_close(telemetry_t *t);

#endif
