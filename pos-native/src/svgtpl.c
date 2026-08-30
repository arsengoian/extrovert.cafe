#include "svgtpl.h"
#include "render.h"
#include <librsvg/rsvg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

char *svgtpl_load(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "svgtpl: не відкрив %s\n", path); return NULL; }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (len < 0) { fclose(f); return NULL; }
    char *buf = malloc((size_t)len + 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[got] = 0;
    return buf;
}

/* Замінює ВСІ входження needle на repl у hay, повертає новий malloc'аний
 * рядок. Верхня межа розміру (hay_len + count*repl_len) навмисно нетугa —
 * шаблони тут по кілька КБ, зайві байти не мають значення. */
static char *replace_all(const char *hay, const char *needle, const char *repl) {
    size_t needle_len = strlen(needle);
    if (needle_len == 0) return strdup(hay);
    size_t repl_len = strlen(repl);

    size_t count = 0;
    const char *p = hay;
    while ((p = strstr(p, needle)) != NULL) { count++; p += needle_len; }

    char *out = malloc(strlen(hay) + count * repl_len + 1);
    if (!out) return NULL;

    char *dst = out;
    const char *src = hay;
    for (;;) {
        const char *found = strstr(src, needle);
        if (!found) { strcpy(dst, src); break; }
        size_t chunk = (size_t)(found - src);
        memcpy(dst, src, chunk);
        dst += chunk;
        memcpy(dst, repl, repl_len);
        dst += repl_len;
        src = found + needle_len;
    }
    return out;
}

char *svgtpl_sub(const char *tpl, const char *const *keys, const char *const *values, int n) {
    char *cur = strdup(tpl);
    if (!cur) return NULL;
    for (int i = 0; i < n; i++) {
        char token[128];
        snprintf(token, sizeof(token), "{{%s}}", keys[i]);
        char *next = replace_all(cur, token, values[i] ? values[i] : "");
        free(cur);
        if (!next) return NULL;
        cur = next;
    }
    return cur;
}

char *svgtpl_esc(const char *s) {
    if (!s) s = "";
    char *out = malloc(strlen(s) * 6 + 1);   /* найдовша заміна — &quot; (6 символів) */
    if (!out) return NULL;
    char *d = out;
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        switch (*p) {
            case '&': memcpy(d, "&amp;", 5); d += 5; break;
            case '<': memcpy(d, "&lt;", 4); d += 4; break;
            case '>': memcpy(d, "&gt;", 4); d += 4; break;
            case '"': memcpy(d, "&quot;", 6); d += 6; break;
            default: *d++ = (char)*p; break;
        }
    }
    *d = 0;
    return out;
}

/* Байт початку останнього UTF-8 кодпоінта в s[0..len) — щоб укорочувати
 * рядок цілими символами, не розрізаючи 2/3-байтну кирилицю навпіл. */
static size_t utf8_prev_start(const char *s, size_t len) {
    if (len == 0) return 0;
    size_t i = len - 1;
    while (i > 0 && ((unsigned char)s[i] & 0xC0) == 0x80) i--;
    return i;
}

char *svgtpl_ellipsize(const char *text, const char *font_spec, double max_w) {
    int w = 0;
    text_extents(font_spec, text, &w, NULL);
    if (w <= max_w) return strdup(text);

    size_t len = strlen(text);
    char *buf = malloc(len + 4);   /* цілий текст + "…" (3 байти UTF-8) + '\0' */
    if (!buf) return NULL;

    while (len > 0) {
        len = utf8_prev_start(text, len);
        memcpy(buf, text, len);
        strcpy(buf + len, "\xE2\x80\xA6");   /* "…" U+2026, UTF-8 */
        text_extents(font_spec, buf, &w, NULL);
        if (w <= max_w) return buf;
    }
    strcpy(buf, "\xE2\x80\xA6");
    return buf;
}

cairo_surface_t *svgtpl_render(const char *svg_text, int w, int h, const char *base_dir) {
    char abspath[PATH_MAX];
    const char *resolved = realpath(base_dir, abspath) ? abspath : base_dir;
    char uri[PATH_MAX + 16];
    snprintf(uri, sizeof(uri), "file://%s/", resolved);

    GError *err = NULL;
    RsvgHandle *handle = rsvg_handle_new();
    rsvg_handle_set_base_uri(handle, uri);

    if (!rsvg_handle_write(handle, (const guchar *)svg_text, strlen(svg_text), &err)) {
        fprintf(stderr, "svgtpl: write: %s\n", err ? err->message : "?");
        if (err) g_error_free(err);
        g_object_unref(handle);
        return NULL;
    }
    if (!rsvg_handle_close(handle, &err)) {
        fprintf(stderr, "svgtpl: close: %s\n", err ? err->message : "?");
        if (err) g_error_free(err);
        g_object_unref(handle);
        return NULL;
    }

    cairo_surface_t *surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, w, h);
    cairo_t *cr = cairo_create(surf);
    /* Шаблони авторовані у своєму реальному пікселі 1:1 (viewBox збігається
     * з w×h, який ми ж і задаємо при виклику) — на відміну від
     * draw_svg_asset() (render.c, лого), тут не треба rsvg_handle_get_
     * dimensions()+scale: розмір заздалегідь відомий і точний. */
    G_GNUC_BEGIN_IGNORE_DEPRECATIONS
    rsvg_handle_render_cairo(handle, cr);
    G_GNUC_END_IGNORE_DEPRECATIONS
    cairo_destroy(cr);
    g_object_unref(handle);
    return surf;
}
