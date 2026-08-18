/* main.c — pos-native: композитор поверх Cairo-контенту.
 *
 *   URL=... POINT=kyiv-01 ASSETS=./assets DESKTOP_FRAMES=180 ./pos-native
 *
 * DESKTOP_FRAMES>0 — вихід після N кадрів і дамп PNG (тестовий режим,
 * дивись build/run-desktop.sh). Без нього — цикл нескінченний, як і
 * призначено для кіоска.
 */
#include "config.h"
#include "menu.h"
#include "render.h"
#include "gl.h"
#include "platform.h"
#include "telemetry.h"

#include <fontconfig/fontconfig.h>
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <signal.h>
#include <math.h>
#include <unistd.h>

static volatile sig_atomic_t g_running = 1;
static volatile sig_atomic_t g_popup_toggle = 0;
static volatile sig_atomic_t g_dump_requested = 0;

static void on_sigterm(int sig) { (void)sig; g_running = 0; }
static void on_sigusr1(int sig) { (void)sig; g_popup_toggle = 1; }  /* демо-тригер попапу */
static void on_sigusr2(int sig) { (void)sig; g_dump_requested = 1; }  /* знімок живого кадру на вимогу */

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

/* Реєструє реальні .ttf як прикладні шрифти для Pango/fontconfig у цьому
 * процесі — не системна інсталяція, так само точково, як лого вставляється
 * через scripts/embed-logo.mjs, а не переписуванням системи. */
static void load_fonts(const char *assets_dir) {
    const char *names[] = { "Extro400", "Extro600", "Extro700", "Extro900" };
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        char path[1024];
        snprintf(path, sizeof(path), "%s/fonts/%s.ttf", assets_dir, names[i]);
        if (!FcConfigAppFontAddFile(FcConfigGetCurrent(), (const FcChar8 *)path))
            fprintf(stderr, "main: не вдалось підвантажити шрифт %s\n", path);
    }
}

/* easing з style.css: cupFloat — ease-in-out, повний період ANIM_CUP_PERIOD_S,
 * амплітуда ANIM_CUP_AMPLITUDE_PX. Апроксимуємо ease-in-out синусом — того
 * самого класу крива, яку CSS дає за замовчуванням для симетричних keyframes. */
static double cup_offset_y(double t, double phase) {
    double x = fmod(t + phase, ANIM_CUP_PERIOD_S) / ANIM_CUP_PERIOD_S;
    return -ANIM_CUP_AMPLITUDE_PX * 0.5 * (1.0 - cos(2.0 * M_PI * x));
}

/* popIn .34s ease-out / popOut .28s ease-in — кубічні наближення теж
 * зайві для ока на попапі; квадратичний ease достатньо помітно відрізняє
 * "влітає" від "лінійно їде". */
static double ease_out(double x) { return 1.0 - (1.0 - x) * (1.0 - x); }
static double ease_in(double x)  { return x * x; }

typedef enum { POPUP_HIDDEN, POPUP_IN, POPUP_SHOWN, POPUP_OUT } popup_state_t;

int main(int argc, char **argv) {
    const char *url = getenv("URL");
    if (!url) url = "https://pos.extrovert.cafe/api/v1/points/kyiv-01/menu";
    const char *assets_dir = getenv("ASSETS");
    if (!assets_dir) assets_dir = "./assets";
    const char *sock_path = getenv("TELEMETRY_SOCK");
    if (!sock_path) sock_path = "/tmp/pos-native.sock";
    int desktop_frames = getenv("DESKTOP_FRAMES") ? atoi(getenv("DESKTOP_FRAMES")) : 0;
    /* POPUP=1 — те саме, що ?popup=1 в app.js: попап сам зʼявляється й
     * ховається по колу, щоб було на що дивитись без ручного тригера
     * (SIGUSR1 лишається для разового ручного показу). */
    bool popup_demo = getenv("POPUP") && strcmp(getenv("POPUP"), "1") == 0;
    (void)argc; (void)argv;

    signal(SIGTERM, on_sigterm);
    signal(SIGINT, on_sigterm);
    signal(SIGUSR1, on_sigusr1);
    signal(SIGUSR2, on_sigusr2);

    fprintf(stderr, "main: старт, url=%s\n", url); fflush(stderr);
    curl_global_init(CURL_GLOBAL_DEFAULT);
    fprintf(stderr, "main: curl_global_init ok, вантажу шрифти...\n"); fflush(stderr);
    load_fonts(assets_dir);
    fprintf(stderr, "main: шрифти ok, platform_init...\n"); fflush(stderr);

    platform_t *plat = platform_init(STAGE_W, STAGE_H);
    if (!plat) { fprintf(stderr, "main: platform_init провалився\n"); return 1; }

    gl_compositor_t comp;
    if (!gl_compositor_init(&comp, STAGE_W, STAGE_H)) return 1;

    telemetry_t tel;
    telemetry_init(&tel, sock_path);

    menu_t menu = {0};
    gl_texture_t bg_tex = {0};
    gl_texture_t cup_tex[MENU_MAX_DRINKS] = {0};
    cup_slot_t cup_slots[MENU_MAX_DRINKS] = {0};
    int cup_count = 0;

    gl_texture_t popup_tex = {0};
    popup_state_t popup_state = POPUP_HIDDEN;
    double popup_t0 = 0;

    /* Перший рендер — синхронно, до входу в цикл: інакше перший кадр
     * малював би порожню сцену, і саме він потрапив би на fps-статистику. */
    if (menu_poll(url, &menu)) {
        fprintf(stderr, "main: меню завантажено, %d напоїв\n", menu.drink_count);
        cairo_surface_t *bg = render_background(&menu, assets_dir, cup_slots);
        if (getenv("DEBUG_CAIRO_PNG")) cairo_surface_write_to_png(bg, getenv("DEBUG_CAIRO_PNG"));
        bg_tex = gl_texture_from_cairo(bg);
        cairo_surface_destroy(bg);
        for (int i = 0; i < menu.drink_count; i++) {
            cairo_surface_t *cs = render_cup_sprite(menu.drinks[i].color, menu.drinks[i].foam);
            cup_tex[i] = gl_texture_from_cairo(cs);
            cairo_surface_destroy(cs);
        }
        cup_count = menu.drink_count;
    } else {
        fprintf(stderr, "main: не вдалось завантажити меню з %s, стартую з порожнім екраном\n", url);
    }

    double t_start = now_s();
    double last_poll = t_start;
    double sim_t = 0;
    long frame_no = 0;

    /* Той самий цикл, що в app.js: показати через 1.2с, тримати 3.2с,
     * сховати, почекати 2.6с, повторити. Використовує той самий
     * g_popup_toggle, що й SIGUSR1 — просто дзвонить сам собі за часом
     * замість чекати сигнал ззовні. */
    double demo_next_t = 1.2;
    int demo_phase = 0;   /* 0 = наступний тригер показує, 1 = ховає */

    while (g_running) {
        double t_now = now_s();
        sim_t = t_now - t_start;

        /* опитування меню — та сама частота, що refreshSec у відповіді сервера */
        if (t_now - last_poll >= (menu.refresh_sec > 0 ? menu.refresh_sec : 60)) {
            last_poll = t_now;
            menu_t next = menu;
            if (menu_poll(url, &next)) {
                menu = next;
                cairo_surface_t *bg = render_background(&menu, assets_dir, cup_slots);
                gl_texture_destroy(&bg_tex);
                bg_tex = gl_texture_from_cairo(bg);
                cairo_surface_destroy(bg);
                for (int i = 0; i < cup_count; i++) gl_texture_destroy(&cup_tex[i]);
                for (int i = 0; i < menu.drink_count; i++) {
                    cairo_surface_t *cs = render_cup_sprite(menu.drinks[i].color, menu.drinks[i].foam);
                    cup_tex[i] = gl_texture_from_cairo(cs);
                    cairo_surface_destroy(cs);
                }
                cup_count = menu.drink_count;
                fprintf(stderr, "main: меню оновлено, %d напоїв\n", cup_count);
            }
        }

        if (popup_demo && sim_t >= demo_next_t) {
            g_popup_toggle = 1;
            if (demo_phase == 0) { demo_next_t = sim_t + 3.2; demo_phase = 1; }
            else                 { demo_next_t = sim_t + 2.6; demo_phase = 0; }
        }

        if (g_popup_toggle) {
            g_popup_toggle = 0;
            if (popup_state == POPUP_HIDDEN) {
                if (!popup_tex.id) {
                    cairo_surface_t *ps = render_popup("Готуємо", "Постав стакан під кран");
                    popup_tex = gl_texture_from_cairo(ps);
                    cairo_surface_destroy(ps);
                }
                popup_state = POPUP_IN; popup_t0 = sim_t;
            } else if (popup_state == POPUP_SHOWN) {
                popup_state = POPUP_OUT; popup_t0 = sim_t;
            }
        }
        if (popup_state == POPUP_IN && sim_t - popup_t0 >= ANIM_POPUP_IN_S) popup_state = POPUP_SHOWN;
        if (popup_state == POPUP_OUT && sim_t - popup_t0 >= ANIM_POPUP_OUT_S) popup_state = POPUP_HIDDEN;

        gl_clear();
        if (bg_tex.id) gl_draw_quad(&comp, &bg_tex, 0, 0, STAGE_W, STAGE_H, 1.0);

        for (int i = 0; i < cup_count; i++) {
            double phase = (i % 3) * ANIM_CUP_PHASE_STAGGER_S;
            double dy = cup_offset_y(sim_t, phase);
            gl_draw_quad(&comp, &cup_tex[i], cup_slots[i].x, cup_slots[i].y + dy,
                         CUP_W, CUP_H, 1.0);
        }

        if (popup_state != POPUP_HIDDEN && popup_tex.id) {
            double px = (STAGE_W - POPUP_W) / 2.0, py = (STAGE_H - POPUP_H) / 2.0;
            double alpha = 1.0, scale = 1.0, dy = 0.0;
            if (popup_state == POPUP_IN) {
                double x = (sim_t - popup_t0) / ANIM_POPUP_IN_S;
                double e = ease_out(x < 0 ? 0 : (x > 1 ? 1 : x));
                alpha = e; scale = 0.94 + 0.06 * e; dy = 24.0 * (1.0 - e);
            } else if (popup_state == POPUP_OUT) {
                double x = (sim_t - popup_t0) / ANIM_POPUP_OUT_S;
                double e = ease_in(x < 0 ? 0 : (x > 1 ? 1 : x));
                alpha = 1.0 - e; scale = 1.0 - 0.04 * e; dy = 18.0 * e;
            }
            double w = POPUP_W * scale, h = POPUP_H * scale;
            gl_draw_quad(&comp, &popup_tex,
                         px + (POPUP_W - w) / 2.0, py + dy + (POPUP_H - h) / 2.0,
                         w, h, alpha);
        }

        platform_swap(plat);
        telemetry_frame(&tel);
        telemetry_poll(&tel);
        frame_no++;

        if (g_dump_requested) {
            g_dump_requested = 0;
            const char *dump_path = getenv("DUMP_PNG");
            if (!dump_path) dump_path = "/tmp/pos-native-frame.png";
            bool ok = platform_dump_png(plat, dump_path);
            fprintf(stderr, "main: SIGUSR2 -> знімок %s: %s\n", dump_path, ok ? "ok" : "провалився");
        }

        if (desktop_frames > 0 && frame_no == desktop_frames / 2) {
            /* середина прогону — демо попапу без керування ззовні */
            g_popup_toggle = 1;
        }
        if (desktop_frames > 0 && frame_no >= desktop_frames) break;
    }

    if (desktop_frames > 0) {
        platform_dump_png(plat, "/tmp/pos-native-frame.png");
        fprintf(stderr, "main: кадр збережено в /tmp/pos-native-frame.png (%ld кадрів, %.1f fps сер.)\n",
                frame_no, frame_no / (now_s() - t_start));
    }

    telemetry_close(&tel);
    gl_texture_destroy(&bg_tex);
    for (int i = 0; i < cup_count; i++) gl_texture_destroy(&cup_tex[i]);
    gl_texture_destroy(&popup_tex);
    platform_destroy(plat);
    curl_global_cleanup();
    return 0;
}
