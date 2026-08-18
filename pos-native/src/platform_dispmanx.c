/* platform_dispmanx.c — реальний Pi 1. Bring-up скопійований 1:1 за
 * структурою з офіційного /opt/vc/src/hello_pi/hello_triangle2/triangle2.c
 * (Broadcom, є на кожній малині зі Stretch) — це не орієнтовний приклад,
 * а перевірений роками шлях, яким на цьому ж залізі працює omxplayer.
 *
 * ⚠️ Цей файл ЩЕ НЕ ЗАПУСКАВСЯ на реальному пристрої (стан на 18.08.2026).
 * Desktop-бекенд (platform_desktop.c) підтвердив, що GLES2-код у gl.c й
 * анімації в main.c коректні; тут може зʼявитися лише щось специфічне для
 * самого dispmanx bring-up — розмір екрана, шар, EGL-конфіг.
 */
#include "platform.h"
#include "bcm_host.h"
#include <GLES2/gl2.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <stdio.h>
#include <stdlib.h>

struct platform {
    EGLDisplay display;
    EGLSurface surface;
    EGLContext context;
    EGL_DISPMANX_WINDOW_T nativewindow;
    DISPMANX_DISPLAY_HANDLE_T dispman_display;
    uint32_t screen_w, screen_h;
};

platform_t *platform_init(int width, int height) {
    platform_t *p = calloc(1, sizeof(*p));
    fprintf(stderr, "dispmanx: bcm_host_init...\n"); fflush(stderr);
    bcm_host_init();
    fprintf(stderr, "dispmanx: bcm_host_init ok\n"); fflush(stderr);

    static const EGLint attr[] = {
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_NONE
    };
    static const EGLint ctx_attr[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
    EGLConfig config; EGLint num_config;

    fprintf(stderr, "dispmanx: eglGetDisplay...\n"); fflush(stderr);
    p->display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (p->display == EGL_NO_DISPLAY) { fprintf(stderr, "dispmanx: eglGetDisplay\n"); goto fail; }
    fprintf(stderr, "dispmanx: eglInitialize...\n"); fflush(stderr);
    if (!eglInitialize(p->display, NULL, NULL)) { fprintf(stderr, "dispmanx: eglInitialize\n"); goto fail; }
    fprintf(stderr, "dispmanx: eglChooseConfig...\n"); fflush(stderr);
    if (!eglChooseConfig(p->display, attr, &config, 1, &num_config)) {
        fprintf(stderr, "dispmanx: eglChooseConfig\n"); goto fail;
    }
    if (!eglBindAPI(EGL_OPENGL_ES_API)) { fprintf(stderr, "dispmanx: eglBindAPI\n"); goto fail; }
    fprintf(stderr, "dispmanx: eglCreateContext...\n"); fflush(stderr);
    p->context = eglCreateContext(p->display, config, EGL_NO_CONTEXT, ctx_attr);
    if (p->context == EGL_NO_CONTEXT) { fprintf(stderr, "dispmanx: eglCreateContext\n"); goto fail; }

    fprintf(stderr, "dispmanx: graphics_get_display_size...\n"); fflush(stderr);
    if (graphics_get_display_size(0, &p->screen_w, &p->screen_h) < 0) {
        fprintf(stderr, "dispmanx: graphics_get_display_size\n"); goto fail;
    }
    fprintf(stderr, "dispmanx: екран %ux%u, кадр малюємо %dx%d\n",
            p->screen_w, p->screen_h, width, height);

    VC_RECT_T dst_rect = { .x = 0, .y = 0, .width = (int)p->screen_w, .height = (int)p->screen_h };
    VC_RECT_T src_rect = { .x = 0, .y = 0,
                            .width = width << 16, .height = height << 16 };

    p->dispman_display = vc_dispmanx_display_open(0);
    DISPMANX_UPDATE_HANDLE_T update = vc_dispmanx_update_start(0);
    /* layer 0 — той самий, що в офіційному прикладі; кіоск-скрипт для
     * native-режиму зупиняє X перед запуском, тож конфліктів шарів немає. */
    DISPMANX_ELEMENT_HANDLE_T element = vc_dispmanx_element_add(
        update, p->dispman_display, 0, &dst_rect, 0, &src_rect,
        DISPMANX_PROTECTION_NONE, 0, 0, 0);

    p->nativewindow.element = element;
    p->nativewindow.width = width;
    p->nativewindow.height = height;
    vc_dispmanx_update_submit_sync(update);

    p->surface = eglCreateWindowSurface(p->display, config, &p->nativewindow, NULL);
    if (p->surface == EGL_NO_SURFACE) { fprintf(stderr, "dispmanx: eglCreateWindowSurface\n"); goto fail; }

    if (!eglMakeCurrent(p->display, p->surface, p->surface, p->context)) {
        fprintf(stderr, "dispmanx: eglMakeCurrent\n"); goto fail;
    }
    fprintf(stderr, "dispmanx: GL_RENDERER=%s\n", (const char *)glGetString(GL_RENDERER));
    glViewport(0, 0, width, height);
    return p;

fail:
    free(p);
    return NULL;
}

void platform_swap(platform_t *p) {
    eglSwapBuffers(p->display, p->surface);   /* тут і є vsync — головна відмінність від desktop */
}

bool platform_dump_png(platform_t *p, const char *path) {
    (void)p; (void)path;
    return false;   /* на малині не потрібно — дивимось на реальний екран */
}

void platform_destroy(platform_t *p) {
    if (!p) return;
    if (p->display) {
        eglMakeCurrent(p->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (p->context) eglDestroyContext(p->display, p->context);
        if (p->surface) eglDestroySurface(p->display, p->surface);
        eglTerminate(p->display);
    }
    free(p);
}
