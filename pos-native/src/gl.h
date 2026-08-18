/* gl.h — тонкий шар над GLES2: один шейдер на текстуровані квади,
 * завантаження текстур із Cairo ARGB32-буфера, малювання з transform
 * (зсув/масштаб у пікселях сцени) і альфою. Той самий код виконується
 * і на десктопі (platform_desktop.c), і на малині (platform_dispmanx.c) —
 * відрізняється лише те, ЯК зʼявляється EGL-контекст, не як малює GLES2. */
#ifndef POS_NATIVE_GL_H
#define POS_NATIVE_GL_H

#include <GLES2/gl2.h>
#include <cairo/cairo.h>

typedef struct {
    GLuint id;
    int w, h;
} gl_texture_t;

typedef struct {
    GLuint program;
    GLuint vbo;
    GLint a_pos, a_uv;
    GLint u_offset_px, u_scale_px, u_stage_size, u_alpha, u_tex;
} gl_compositor_t;

/* Ініціалізація виконується один раз після eglMakeCurrent. */
int gl_compositor_init(gl_compositor_t *c, int stage_w, int stage_h);

/* Створює/оновлює текстуру з ARGB32-поверхні Cairo. cairo зберігає у
 * форматі, який на little-endian машинах збігається з GL_BGRA —
 * завантажуємо напряму, без конвертації по байтах на CPU щоразу. */
gl_texture_t gl_texture_from_cairo(cairo_surface_t *surf);
void gl_texture_destroy(gl_texture_t *t);

/* offset_x/y, scale — у пікселях сцени (1920×1080), не в NDC: рахувати
 * анімацію зручніше в тих самих одиницях, що й config.h/render.c. */
void gl_draw_quad(gl_compositor_t *c, const gl_texture_t *tex,
                   double dst_x, double dst_y, double dst_w, double dst_h,
                   double alpha);

void gl_clear(void);

#endif
