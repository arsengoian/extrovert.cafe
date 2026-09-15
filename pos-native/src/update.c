#include "update.h"
#include "config.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

static const char *DEFAULT_LABEL = "ОНОВЛЕННЯ…";

void update_init(update_state_t *u, const char *flag_path) {
    memset(u, 0, sizeof(*u));
    /* last_check_s = 0, а перший кадр приходить із sim_t близько нуля —
     * тому перша ж перевірка відбудеться одразу, без очікування періоду. */
    u->last_check_s = -UPDATE_POLL_PERIOD_S;
    (void)flag_path;
}

void update_poll(update_state_t *u, const char *flag_path, double now_s) {
    u->dirty = false;
    if (!flag_path || !flag_path[0]) return;
    if (now_s - u->last_check_s < UPDATE_POLL_PERIOD_S) return;
    u->last_check_s = now_s;

    struct stat st;
    bool present = (stat(flag_path, &st) == 0);

    char label[UPDATE_LABEL_MAX];
    label[0] = 0;
    if (present) {
        /* Порожній або нечитабельний файл — не помилка: прапорець уже сам
         * по собі сигнал, підпис лише уточнює. */
        FILE *f = fopen(flag_path, "r");
        if (f) {
            if (fgets(label, sizeof(label), f)) {
                size_t n = strlen(label);
                while (n > 0 && (label[n - 1] == '\n' || label[n - 1] == '\r')) label[--n] = 0;
            }
            fclose(f);
        }
        if (!label[0]) snprintf(label, sizeof(label), "%s", DEFAULT_LABEL);
    }

    if (present != u->active || strcmp(label, u->label) != 0) {
        u->active = present;
        memcpy(u->label, label, sizeof(label));
        u->dirty = true;
    }
}
