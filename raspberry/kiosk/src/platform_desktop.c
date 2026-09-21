/* platform_desktop.c — headless GLES2 через EGL_PLATFORM_SURFACELESS_MESA
 * і власний FBO. Без X11, без /dev/dri (у пісочниці його немає), без вікна
 * взагалі — рендеримо в текстуру й читаємо glReadPixels для PNG.
 *
 * Підхід перевірений окремим smoke-тестом перед тим, як писати цей файл:
 * eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, ...) повертає дисплей
 * лише якщо __EGL_VENDOR_LIBRARY_FILENAMES вказує на 50_mesa.json (glvnd без
 * цього мовчки не знаходить драйвер) і LIBGL_ALWAYS_SOFTWARE=1 змушує Mesa
 * взяти llvmpipe замість пошуку апаратного GPU, якого тут немає. Обидва
 * прапорці виставляє build/env-desktop.sh, а не сам бінарник — на реальному
 * десктопі з GPU вони можуть бути й не потрібні.
 */
#include "platform.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <stdio.h>
#include <stdlib.h>
#include <png.h>

struct platform {
    EGLDisplay dpy;
    EGLContext ctx;
    GLuint fbo, color_tex;
    int w, h;
};

platform_t *platform_init(int width, int height) {
    platform_t *p = calloc(1, sizeof(*p));
    p->w = width; p->h = height;

    p->dpy = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    if (p->dpy == EGL_NO_DISPLAY) { fprintf(stderr, "platform: немає EGL-дисплея\n"); goto fail; }

    EGLint maj, min;
    if (!eglInitialize(p->dpy, &maj, &min)) {
        fprintf(stderr, "platform: eglInitialize 0x%x\n", eglGetError()); goto fail;
    }
    fprintf(stderr, "platform: EGL %d.%d, %s / %s\n", maj, min,
            eglQueryString(p->dpy, EGL_VENDOR), eglQueryString(p->dpy, EGL_VERSION));

    EGLint cfg_attr[] = {
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    EGLConfig cfg; EGLint ncfg;
    if (!eglChooseConfig(p->dpy, cfg_attr, &cfg, 1, &ncfg) || ncfg < 1) {
        fprintf(stderr, "platform: eglChooseConfig 0x%x\n", eglGetError()); goto fail;
    }
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint ctx_attr[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
    p->ctx = eglCreateContext(p->dpy, cfg, EGL_NO_CONTEXT, ctx_attr);
    if (p->ctx == EGL_NO_CONTEXT) { fprintf(stderr, "platform: eglCreateContext 0x%x\n", eglGetError()); goto fail; }

    if (!eglMakeCurrent(p->dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, p->ctx)) {
        fprintf(stderr, "platform: eglMakeCurrent (surfaceless) 0x%x\n", eglGetError()); goto fail;
    }
    fprintf(stderr, "platform: GL_RENDERER=%s\n", (const char *)glGetString(GL_RENDERER));

    glGenTextures(1, &p->color_tex);
    glBindTexture(GL_TEXTURE_2D, p->color_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

    glGenFramebuffers(1, &p->fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, p->fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, p->color_tex, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "platform: FBO неповний\n"); goto fail;
    }
    glViewport(0, 0, width, height);
    return p;

fail:
    free(p);
    return NULL;
}

void platform_swap(platform_t *p) {
    /* Немає вікна — nічого «показувати». glFinish() тут відіграє роль vsync:
     * без реального дисплея GPU нічого не притримує, тож без цього цикл
     * малював би мільйони кадрів на секунду й телеметрія показувала б
     * нереалістичні числа, які на десктопі й так нічого не доводять (див.
     * platform.h) — але хай хоч не будуть відверто безглуздими. */
    glFinish();
    (void)p;
}

bool platform_dump_png(platform_t *p, const char *path) {
    unsigned char *pixels = malloc((size_t)p->w * p->h * 4);
    glReadPixels(0, 0, p->w, p->h, GL_RGBA, GL_UNSIGNED_BYTE, pixels);

    FILE *f = fopen(path, "wb");
    if (!f) { free(pixels); return false; }
    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    png_infop info = png_create_info_struct(png);
    png_init_io(png, f);
    png_set_IHDR(png, info, p->w, p->h, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png, info);
    /* glReadPixels рахує рядки знизу вгору, PNG пишеться згори вниз */
    for (int y = p->h - 1; y >= 0; y--)
        png_write_row(png, pixels + (size_t)y * p->w * 4);
    png_write_end(png, NULL);
    png_destroy_write_struct(&png, &info);
    fclose(f);
    free(pixels);
    return true;
}

void platform_destroy(platform_t *p) {
    if (!p) return;
    if (p->dpy) {
        eglMakeCurrent(p->dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (p->ctx) eglDestroyContext(p->dpy, p->ctx);
        eglTerminate(p->dpy);
    }
    free(p);
}
