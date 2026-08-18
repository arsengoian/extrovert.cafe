/* platform.h — усе, чим відрізняється «де малювати» між малиною і десктопом.
 * GLES2-код у gl.c/render.c/main.c однаковий на обох; тут — лише те, як
 * зʼявляється EGL-контекст і як кадр потрапляє на екран (чи у файл).
 *
 * platform_desktop.c — EGL_PLATFORM_SURFACELESS_MESA + власний FBO,
 *   для тестів у пісочниці/Docker/WSL без GPU. Перевірено вручну smoke-тестом
 *   18.08.2026: llvmpipe (Mesa 23.2, software), GLES 3.2, malloc-текстура
 *   64×64 читається коректно через glReadPixels.
 * platform_dispmanx.c — bcm_host + dispmanx + EGL, для Pi 1. Написаний за
 *   зразком офіційних /opt/vc/src/hello_pi/hello_dispmanx і hello_triangle2,
 *   але ЩЕ НЕ ЗАПУСКАВСЯ на реальному залізі — це наступний крок після того,
 *   як desktop-варіант підтвердить, що логіка рендеру й анімацій коректна.
 */
#ifndef POS_NATIVE_PLATFORM_H
#define POS_NATIVE_PLATFORM_H

#include <stdbool.h>

typedef struct platform platform_t;

/* width/height — розмір цільового кадру (STAGE_W×STAGE_H). */
platform_t *platform_init(int width, int height);

/* Викликається щокадру ПІСЛЯ малювання: на малині — eglSwapBuffers у
 * dispmanx-вікно (vsync); на десктопі — no-op чи запис PNG за потреби. */
void platform_swap(platform_t *p);

/* На десктопі дозволяє вивантажити поточний кадр як PNG для візуальної
 * перевірки. На малині — no-op (повертає false). */
bool platform_dump_png(platform_t *p, const char *path);

void platform_destroy(platform_t *p);

#endif
