/* ssl_locks.h — замки для OpenSSL 1.0.2, з яким libcurl зібраний на Stretch.
 * Див. ssl_locks.c. */
#ifndef SSL_LOCKS_H
#define SSL_LOCKS_H

/* Кликати один раз, одразу після curl_global_init() і ДО першого потоку,
 * що ходить у мережу. → скільки замків поставили; 0 — не треба (в процесі
 * немає OpenSSL 1.0.2 або колбек уже стоїть); -1 — 1.0.2 є, а поставити
 * не вийшло. */
int ssl_locks_init(void);

#endif
