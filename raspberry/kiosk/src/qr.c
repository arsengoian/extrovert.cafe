#include "qr.h"
#include "qrcodegen.h"
#include <stdio.h>

bool qr_paint(cairo_t *cr, const char *text, double x, double y, double size) {
    uint8_t tmp[qrcodegen_BUFFER_LEN_MAX];
    uint8_t qr[qrcodegen_BUFFER_LEN_MAX];

    bool ok = qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_MEDIUM,
                                    qrcodegen_VERSION_MIN, qrcodegen_VERSION_MAX,
                                    qrcodegen_Mask_AUTO, true);
    if (!ok) {
        fprintf(stderr, "qr: не влізло в жодну версію: %s\n", text);
        return false;
    }

    int modules = qrcodegen_getSize(qr);
    double m = size / modules;

    /* Модулі — прямокутники, а не квадрати з rx=0.3, як у макеті. На наших
     * розмірах заокруглення субпіксельне (модуль 2,2 px у рядку, 3,9 px у
     * попапі — радіус 0,7 і 1,2 px), а дуги на Pi 1 коштували 164 мс на
     * код. Сусідні модулі рядка зливаються в одну смугу: менше елементів
     * контуру — дешевше растеризувати. */
    cairo_save(cr);
    cairo_new_path(cr);
    for (int j = 0; j < modules; j++) {
        int i = 0;
        while (i < modules) {
            if (!qrcodegen_getModule(qr, i, j)) { i++; continue; }
            int run = 1;
            while (i + run < modules && qrcodegen_getModule(qr, i + run, j)) run++;
            cairo_rectangle(cr, x + i * m, y + j * m, run * m, m);
            i += run;
        }
    }
    /* Один контур і ОДНЕ заповнення на весь код. Смуги сусідніх рядків
     * торкаються краями, але не перетинаються — правило заповнення ні на що
     * не впливає. */
    cairo_set_source_rgb(cr, 1, 1, 1);
    cairo_fill(cr);
    cairo_restore(cr);
    return true;
}
