/* ssl_locks.c — замки для OpenSSL 1.0.2 (15.10.2026).
 *
 * libcurl на Raspbian Stretch (7.52.1) зібраний з libssl.so.1.0.2, а
 * OpenSSL до 1.1.0 потокобезпечний лише тоді, коли застосунок сам дав йому
 * замки (CRYPTO_set_locking_callback, libcurl-thread(3)). Ні libcurl, ні
 * жодна з 83 бібліотек процесу кіоска цього не робить (перевірено objdump
 * 15.10.2026), а кіоск ходить у TLS із двох потоків одночасно: потік меню
 * (menu.json і підтвердження деплою) і потік ws (wss:// і знімок стану при
 * кожному підключенні). Без замків OpenSSL пише у свої спільні таблиці —
 * рушії шифрів, ex_data, генератор випадкових чисел — з обох потоків
 * водночас; найімовірніше це трапляється, коли обидва потоки
 * перепідключаються разом після обриву мережі. Наслідок — рідкісне падіння
 * кіоска або зіпсований стан ГВЧ: стрес під QEMU на тих самих бібліотеках
 * (6 потоків, нові TLS-зʼєднання) без замків падав із SIGSEGV у двох
 * прогонах із трьох, із замками — ні. На одноядерному Pi 1 вікно для гонки
 * набагато вужче, і в телеметрії з 26.09.2026 непланових перезапусків
 * кіоска не видно, тож це запобіжник, а не ліки від відомого падіння.
 *
 * Без заголовків OpenSSL: їх у збиральному контейнері немає (libssl1.0-dev
 * не ставили), а міняти образ заради чотирьох функцій не варто. Тому беремо
 * вже завантажену бібліотеку за її soname (RTLD_NOLOAD — нічого нового не
 * вантажимо) і шукаємо функції в ній. На десктопі libcurl іде з OpenSSL 3,
 * який потокобезпечний сам, — libcrypto.so.1.0.2 у процесі немає, і тут
 * нічого не відбувається.
 *
 * Ідентифікатор потоку не ставимо: без колбека 1.0.2 бере адресу errno, а в
 * glibc вона своя в кожного потоку (crypto/cryptlib.c, CRYPTO_THREADID_current).
 * Динамічні замки (CRYPTO_set_dynlock_*) потрібні лише окремим рушіям — не нам. */
#define _GNU_SOURCE
#include "ssl_locks.h"

#include <dlfcn.h>
#include <pthread.h>
#include <stdlib.h>

#define CRYPTO_LOCK 1   /* openssl/crypto.h 1.0.x: біт режиму «взяти замок» */

typedef void (*lock_fn)(int mode, int n, const char *file, int line);

static pthread_mutex_t *locks;
static int nlocks;

static void lock_cb(int mode, int n, const char *file, int line) {
    (void)file; (void)line;
    if (n < 0 || n >= nlocks) return;
    if (mode & CRYPTO_LOCK) pthread_mutex_lock(&locks[n]);
    else pthread_mutex_unlock(&locks[n]);
}

int ssl_locks_init(void) {
    void *h = dlopen("libcrypto.so.1.0.2", RTLD_NOW | RTLD_NOLOAD);
    if (!h) return 0;
    int (*num_locks)(void) = (int (*)(void))dlsym(h, "CRYPTO_num_locks");
    void (*set_cb)(lock_fn) = (void (*)(lock_fn))dlsym(h, "CRYPTO_set_locking_callback");
    lock_fn (*get_cb)(void) = (lock_fn (*)(void))dlsym(h, "CRYPTO_get_locking_callback");
    if (!num_locks || !set_cb) return -1;
    if (get_cb && get_cb()) return 0;   /* хтось уже поставив */
    int n = num_locks();
    if (n <= 0) return -1;
    locks = calloc((size_t)n, sizeof *locks);
    if (!locks) return -1;
    for (int i = 0; i < n; i++) pthread_mutex_init(&locks[i], NULL);
    nlocks = n;
    set_cb(lock_cb);
    /* h не закриваємо: бібліотека однаково живе до кінця процесу. */
    return n;
}
