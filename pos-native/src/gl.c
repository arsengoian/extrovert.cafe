#include "gl.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Вершинний шейдер бере одиничний квад (0..1) і сам переводить його в NDC
 * через розмір сцени — так gl_draw_quad() оперує пікселями, а не -1..1. */
static const char *VS =
    "attribute vec2 a_pos;\n"
    "attribute vec2 a_uv;\n"
    "uniform vec2 u_offset_px;\n"
    "uniform vec2 u_scale_px;\n"
    "uniform vec2 u_stage_size;\n"
    "varying vec2 v_uv;\n"
    "void main() {\n"
    "  vec2 px = u_offset_px + a_pos * u_scale_px;\n"
    "  vec2 ndc = (px / u_stage_size) * 2.0 - 1.0;\n"
    "  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);\n"
    "  v_uv = a_uv;\n"
    "}\n";

static const char *FS =
    "precision mediump float;\n"
    "varying vec2 v_uv;\n"
    "uniform sampler2D u_tex;\n"
    "uniform float u_alpha;\n"
    "void main() {\n"
    "  vec4 c = texture2D(u_tex, v_uv);\n"
    "  gl_FragColor = vec4(c.rgb, c.a * u_alpha);\n"
    "}\n";

static GLuint compile(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetShaderInfoLog(s, sizeof(log), NULL, log);
        fprintf(stderr, "gl: шейдер не скомпілювався: %s\n", log);
        exit(1);
    }
    return s;
}

int gl_compositor_init(gl_compositor_t *c, int stage_w, int stage_h) {
    memset(c, 0, sizeof(*c));
    GLuint vs = compile(GL_VERTEX_SHADER, VS);
    GLuint fs = compile(GL_FRAGMENT_SHADER, FS);
    c->program = glCreateProgram();
    glAttachShader(c->program, vs);
    glAttachShader(c->program, fs);
    glLinkProgram(c->program);
    GLint ok = 0;
    glGetProgramiv(c->program, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetProgramInfoLog(c->program, sizeof(log), NULL, log);
        fprintf(stderr, "gl: лінк програми не вдався: %s\n", log);
        return 0;
    }
    glDeleteShader(vs);
    glDeleteShader(fs);

    /* одиничний квад: pos.xy 0..1, uv 0..1 (v перевернута, бо Cairo рядки
     * йдуть згори, а текстурні координати GL — знизу) */
    GLfloat verts[] = {
        /* x    y    u    v */
        0.f, 0.f, 0.f, 0.f,
        1.f, 0.f, 1.f, 0.f,
        0.f, 1.f, 0.f, 1.f,
        1.f, 1.f, 1.f, 1.f,
    };
    glGenBuffers(1, &c->vbo);
    glBindBuffer(GL_ARRAY_BUFFER, c->vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(verts), verts, GL_STATIC_DRAW);

    c->a_pos = glGetAttribLocation(c->program, "a_pos");
    c->a_uv = glGetAttribLocation(c->program, "a_uv");
    c->u_offset_px = glGetUniformLocation(c->program, "u_offset_px");
    c->u_scale_px = glGetUniformLocation(c->program, "u_scale_px");
    c->u_stage_size = glGetUniformLocation(c->program, "u_stage_size");
    c->u_alpha = glGetUniformLocation(c->program, "u_alpha");
    c->u_tex = glGetUniformLocation(c->program, "u_tex");

    glEnable(GL_BLEND);
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);   /* текстури з premultiplied alpha (Cairo) */

    /* Розмір сцени сталий на весь запуск — досить виставити раз, а не
     * щокадру. Без цього виклику юніформ лишався (0,0): вершинний шейдер
     * ділив на нуль, координати йшли в NaN, і всі квади зникали з екрана —
     * саме так виглядав перший запуск (чорний кадр при коректному Cairo-фоні). */
    glUseProgram(c->program);
    glUniform2f(c->u_stage_size, (float)stage_w, (float)stage_h);
    return 1;
}

gl_texture_t gl_texture_from_cairo(cairo_surface_t *surf) {
    gl_texture_t t = {0};
    cairo_surface_flush(surf);
    t.w = cairo_image_surface_get_width(surf);
    t.h = cairo_image_surface_get_height(surf);
    unsigned char *data = cairo_image_surface_get_data(surf);

    glGenTextures(1, &t.id);
    glBindTexture(GL_TEXTURE_2D, t.id);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    /* Cairo ARGB32 на little-endian — це байти B,G,R,A у памʼяті, premultiplied.
     * GLES2 без GL_EXT_texture_format_BGRA8888 знає лише RGBA-порядок читання,
     * тож або є розширення (перевіряємо в build-скрипті), або конвертуємо на
     * CPU один раз при завантаженні — це рідкісна операція (при зміні цін),
     * тому цілком прийнятна ціна. */
#ifdef POS_NATIVE_HAVE_BGRA
    glTexImage2D(GL_TEXTURE_2D, 0, GL_BGRA_EXT, t.w, t.h, 0, GL_BGRA_EXT, GL_UNSIGNED_BYTE, data);
#else
    {
        int n = t.w * t.h;
        unsigned char *rgba = malloc((size_t)n * 4);
        for (int i = 0; i < n; i++) {
            rgba[i*4+0] = data[i*4+2];
            rgba[i*4+1] = data[i*4+1];
            rgba[i*4+2] = data[i*4+0];
            rgba[i*4+3] = data[i*4+3];
        }
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, t.w, t.h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
        free(rgba);
    }
#endif
    return t;
}

void gl_texture_destroy(gl_texture_t *t) {
    if (t->id) glDeleteTextures(1, &t->id);
    t->id = 0;
}

void gl_draw_quad(gl_compositor_t *c, const gl_texture_t *tex,
                   double dst_x, double dst_y, double dst_w, double dst_h,
                   double alpha) {
    if (getenv("GL_DEBUG"))
        fprintf(stderr, "gl_draw_quad: tex=%u %dx%d dst=%.0f,%.0f %.0fx%.0f a=%.2f prog=%u locs pos=%d uv=%d off=%d scale=%d stage=%d alpha=%d tex_u=%d\n",
                tex->id, tex->w, tex->h, dst_x, dst_y, dst_w, dst_h, alpha,
                c->program, c->a_pos, c->a_uv, c->u_offset_px, c->u_scale_px,
                c->u_stage_size, c->u_alpha, c->u_tex);
    glUseProgram(c->program);
    glBindBuffer(GL_ARRAY_BUFFER, c->vbo);
    glEnableVertexAttribArray(c->a_pos);
    glEnableVertexAttribArray(c->a_uv);
    glVertexAttribPointer(c->a_pos, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), (void *)0);
    glVertexAttribPointer(c->a_uv, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), (void *)(2 * sizeof(GLfloat)));

    glUniform2f(c->u_offset_px, (float)dst_x, (float)dst_y);
    glUniform2f(c->u_scale_px, (float)dst_w, (float)dst_h);
    glUniform1f(c->u_alpha, (float)alpha);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, tex->id);
    glUniform1i(c->u_tex, 0);

    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

void gl_clear(void) {
    glClearColor(0.f, 0.f, 0.f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT);
}
