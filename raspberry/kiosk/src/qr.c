#include "qr.h"
#include "render.h"     /* rounded_rect() */
#include "qrcodegen.h"
#include <stdio.h>

/* Тиха зона навмисно НЕ малюється тут: у макеті (monitor-menu.svg) код
 * сидить у 64px квадраті всередині темного кола 104px діаметром — саме
 * коло дає поля, а не сам QR. render_qr() віддає модулі край-в-край
 * (viewBox самого макетного QR — рівно кількість модулів, без полів);
 * той, хто розміщує текстуру на сцені, має лишити їй місце навколо. */
cairo_surface_t *render_qr(const char *text, int px_size) {
    uint8_t tmp[qrcodegen_BUFFER_LEN_MAX];
    uint8_t qr[qrcodegen_BUFFER_LEN_MAX];

    bool ok = qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_MEDIUM,
                                    qrcodegen_VERSION_MIN, qrcodegen_VERSION_MAX,
                                    qrcodegen_Mask_AUTO, true);
    if (!ok) {
        fprintf(stderr, "qr: не влізло в жодну версію: %s\n", text);
        return NULL;
    }

    int modules = qrcodegen_getSize(qr);
    double mod_px = (double)px_size / modules;
    /* 30% заокруглення на модуль — з макета (кожен <rect> модуля має rx=0.3
     * при розмірі 1×1, тобто радіус = 0.3 стороны). */
    double r = 0.3 * mod_px;

    cairo_surface_t *s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, px_size, px_size);
    cairo_t *cr = cairo_create(s);
    cairo_set_source_rgb(cr, 1, 1, 1);   /* білий — фон лишається прозорим (сфейс і так порожній) */
    for (int y = 0; y < modules; y++) {
        for (int x = 0; x < modules; x++) {
            if (!qrcodegen_getModule(qr, x, y)) continue;
            rounded_rect(cr, x * mod_px, y * mod_px, mod_px, mod_px, r);
            cairo_fill(cr);
        }
    }
    cairo_destroy(cr);
    return s;
}
