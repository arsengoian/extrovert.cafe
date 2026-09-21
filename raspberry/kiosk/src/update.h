/* update.h — кіоск дізнається, що його зараз оновлюють.
 *
 * Канал навмисно найпростіший із можливих: файл-прапорець у теці стану
 * ($EXTROVERT_STATE/updating, пише raspberry/pi/stack/updater.sh). Не сигнал і не
 * команда в telemetry-сокет, бо:
 *   - стан переживає перезапуск БУДЬ-ЯКОЇ зі сторін (сигнал, посланий
 *     процесу, якого зараз рестартують, губиться назавжди);
 *   - апдейтер — shell-скрипт, для якого `echo > file` це один рядок без
 *     жодної залежності, а клієнт цього сокета довелось би писати;
 *   - перевірка коштує stat() раз на секунду (UPDATE_POLL_PERIOD_S).
 *
 * Перший рядок файла (якщо є) — підпис для плашки, напр. "2026.09.15".
 * Порожній файл теж валідний: тоді показуємо типовий текст.
 */
#ifndef POS_NATIVE_UPDATE_H
#define POS_NATIVE_UPDATE_H

#include <stdbool.h>

#define UPDATE_LABEL_MAX 64

typedef struct {
    bool active;                      /* прапорець на місці — малюємо плашку */
    char label[UPDATE_LABEL_MAX];     /* що саме показати в плашці */
    double last_check_s;              /* внутрішнє: коли востаннє робили stat() */
    bool dirty;                       /* стан змінився з минулого кадру — перепекти текстуру */
} update_state_t;

/* flag_path == NULL або "" — механізм вимкнено, active лишається false
 * назавжди (десктопний прогін, тест). */
void update_init(update_state_t *u, const char *flag_path);

/* Викликати щокадру: сама вирішує, чи вже час робити stat(). Виставляє
 * u->dirty, коли active/label змінились. */
void update_poll(update_state_t *u, const char *flag_path, double now_s);

#endif
