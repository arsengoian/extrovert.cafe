/* dispmanx-snap.c — знімок УСЬОГО екрана малини: фреймбуфер (запасна
 * картинка fbi, консоль) разом з усіма dispmanx-шарами (кіоск, обидві копії
 * на overlap-підміні). SIGUSR2 кіоска бачить лише власний GL-кадр, а тут —
 * те, що справді на моніторі. Для перевірок з ПК, коли до екрана не дійти.
 *
 * Збирається там само, де кіоск, — у контейнері на ПК, не на малині:
 *   ./docker/make-pi.sh tools     →  bin/dispmanx-snap
 * На малині:
 *   dispmanx-snap /tmp/screen.rgba   # сирий RGBA, розмір екрана в stderr
 */
#include <bcm_host.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    const char *out = argc > 1 ? argv[1] : "/tmp/screen.rgba";
    bcm_host_init();
    DISPMANX_DISPLAY_HANDLE_T display = vc_dispmanx_display_open(0);
    if (!display) { fprintf(stderr, "snap: display_open\n"); return 1; }
    DISPMANX_MODEINFO_T info;
    if (vc_dispmanx_display_get_info(display, &info) != 0) { fprintf(stderr, "snap: get_info\n"); return 1; }

    uint32_t handle;
    DISPMANX_RESOURCE_HANDLE_T res =
        vc_dispmanx_resource_create(VC_IMAGE_RGBA32, info.width, info.height, &handle);
    if (vc_dispmanx_snapshot(display, res, DISPMANX_NO_ROTATE) != 0) { fprintf(stderr, "snap: snapshot\n"); return 1; }

    int pitch = info.width * 4;
    unsigned char *buf = malloc((size_t)pitch * info.height);
    if (!buf) return 1;
    VC_RECT_T rect;
    vc_dispmanx_rect_set(&rect, 0, 0, info.width, info.height);
    vc_dispmanx_resource_read_data(res, &rect, buf, pitch);

    FILE *f = fopen(out, "wb");
    if (!f) { fprintf(stderr, "snap: не відкрився %s\n", out); return 1; }
    fwrite(buf, 1, (size_t)pitch * info.height, f);
    fclose(f);
    fprintf(stderr, "snap: %dx%d RGBA → %s\n", info.width, info.height, out);

    free(buf);
    vc_dispmanx_resource_delete(res);
    vc_dispmanx_display_close(display);
    bcm_host_deinit();
    return 0;
}
