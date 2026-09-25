#include "selftest.h"
#include "config.h"
#include "menu.h"
#include "render.h"
#include "popup.h"
#include "qr.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <unistd.h>
#include <time.h>

/* Файли, без яких кіоск намалює порожнечу. Перевіряємо існування ОКРЕМО
 * від рендеру: librsvg на відсутню картинку не лається, просто не малює її —
 * тобто неповний архів пройшов би рендер-перевірку з майже правильним
 * виглядом і зламався б уже на точці. */
static const char *REQUIRED[] = {
    "fonts/Extro400.ttf", "fonts/Extro600.ttf", "fonts/Extro700.ttf",
    "fonts/Extro900.ttf", "fonts/Extro1000.ttf",
    "fonts/Poppins-Regular.ttf", "fonts/Poppins-SemiBold.ttf", "fonts/Poppins-Bold.ttf",
    "templates/menu.svg", "templates/card.svg", "templates/card_bonus.svg",
    "templates/ad.svg", "templates/bonus_header.svg", "templates/bonus_empty.svg",
    "templates/bonus_row.svg", "templates/bonus_secret.svg",
    "templates/popup.svg", "templates/popup_bonus.svg", "templates/popup_secret.svg",
    "logo_dark.svg", "ui/coin_gold.png", "ui/hero_bush.png",
};

/* Час рендера кожної поверхні — у тому самому рядку лога. Selftest ганяє
 * рівно ті функції, що й кадровий цикл, тож на пристрої це найдешевший
 * спосіб побачити, скільки коштує, наприклад, поява попапу: кіоск цей час
 * стоїть (21.09.2026 так знайшли 1,4-секундне завмирання на бонусі). */
static double g_mark_ms;
static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6;
}
static void mark(void) { g_mark_ms = now_ms(); }

/* Скільки пікселів мають відрізнятись від лівого верхнього кута, щоб
 * вважати поверхню намальованою. Поріг свідомо низький (0,5 %): мета —
 * відрізнити "щось намальовано" від "суцільна заливка/прозорість", а не
 * оцінювати схожість на макет. */
static bool surface_has_ink(cairo_surface_t *s, const char *what) {
    double took_ms = now_ms() - g_mark_ms;
    if (!s) {
        fprintf(stderr, "selftest: %s — рендер повернув NULL\n", what);
        return false;
    }
    if (cairo_surface_status(s) != CAIRO_STATUS_SUCCESS) {
        fprintf(stderr, "selftest: %s — cairo status %s\n", what,
                cairo_status_to_string(cairo_surface_status(s)));
        return false;
    }
    cairo_surface_flush(s);
    int w = cairo_image_surface_get_width(s);
    int h = cairo_image_surface_get_height(s);
    int stride = cairo_image_surface_get_stride(s);
    const unsigned char *data = cairo_image_surface_get_data(s);
    if (!data || w <= 0 || h <= 0) {
        fprintf(stderr, "selftest: %s — порожня поверхня %dx%d\n", what, w, h);
        return false;
    }

    const uint32_t *row0 = (const uint32_t *)data;
    uint32_t bg = row0[0];
    long differing = 0;
    /* Крок 4 по обох осях: на 1920×1080 це 130 тисяч проб замість двох
     * мільйонів — на Pi 1 різниця між "миттєво" і "півсекунди", а для
     * порогу 0,5 % точності проби вистачає з запасом. */
    for (int y = 0; y < h; y += 4) {
        const uint32_t *row = (const uint32_t *)(data + (size_t)y * stride);
        for (int x = 0; x < w; x += 4) {
            if (row[x] != bg) differing++;
        }
    }
    long sampled = ((long)h / 4 + 1) * ((long)w / 4 + 1);
    double frac = sampled > 0 ? (double)differing / (double)sampled : 0.0;
    if (frac < 0.005) {
        fprintf(stderr, "selftest: %s — майже однотонна поверхня (%.3f%% відмінних)\n",
                what, frac * 100.0);
        return false;
    }
    fprintf(stderr, "selftest: %s ok (%dx%d, %.1f%% відмінних, %.0f мс)\n",
            what, w, h, frac * 100.0, took_ms);
    return true;
}

/* Синтетичне меню замість справжнього з мережі: перевірка має проходити
 * на пристрої, який щойно втратив звʼязок (оновлення могло приїхати
 * останнім успішним запитом), і має бути детермінованою — інакше
 * "тест впав" означало б "сьогодні в меню інший набір напоїв". */
static void build_fixture(menu_t *m) {
    memset(m, 0, sizeof(*m));
    m->valid = true;
    m->refresh_sec = MENU_REFRESH_SEC;
    snprintf(m->brand_name, MENU_STR, "%s", BRAND_NAME);
    snprintf(m->brand_suffix, MENU_STR, "%s", BRAND_SUFFIX);
    menu_fill_cups(m);

    struct { const char *name, *vol, *sprite, *cup; int price, bonus; } fx[] = {
        { "Еспресо",              "30 мл",  "espresso",   "S", 35,  0  },
        { "Американо",            "150 мл", "americano",  "M", 40,  0  },
        { "Американо з бонусами", "150 мл", "americano",  "M", 80,  80 },
        { "Капучино",             "260 мл", "cappuccino", "L", 50,  0  },
    };
    for (size_t i = 0; i < sizeof(fx) / sizeof(fx[0]); i++) {
        drink_t *d = &m->drinks[m->drink_count++];
        snprintf(d->name, MENU_STR, "%s", fx[i].name);
        snprintf(d->vol, MENU_STR, "%s", fx[i].vol);
        snprintf(d->sprite, sizeof(d->sprite), "%s", fx[i].sprite);
        snprintf(d->cup, sizeof(d->cup), "%s", fx[i].cup);
        d->price = fx[i].price;
        d->is_bonus = fx[i].bonus > 0;
        d->coins = fx[i].bonus;
        d->foam = true;
    }

    m->ad.valid = true;
    snprintf(m->ad.promo_label, MENU_STR, "АКЦІЯ");
    snprintf(m->ad.head1, MENU_STR, "Перевірка оновлення");
    snprintf(m->ad.head2, MENU_STR, "extrovert.cafe");
    snprintf(m->ad.sub, MENU_STR, "selftest");
    snprintf(m->ad.fine, MENU_STR, "цей екран ніхто не побачить");
    snprintf(m->ad.sprite, sizeof(m->ad.sprite), "espresso");
}

int selftest_run(const char *assets_dir, const char *out_png) {
    int failures = 0;

    for (size_t i = 0; i < sizeof(REQUIRED) / sizeof(REQUIRED[0]); i++) {
        char path[1024];
        snprintf(path, sizeof(path), "%s/%s", assets_dir, REQUIRED[i]);
        if (access(path, R_OK) != 0) {
            fprintf(stderr, "selftest: нема або не читається %s\n", path);
            failures++;
        }
    }
    if (failures) {
        fprintf(stderr, "selftest: архів неповний (%d файлів) — далі не йдемо\n", failures);
        return 1;
    }

    menu_t m;
    build_fixture(&m);

    mark();
    cairo_surface_t *menu_s = render_menu(&m, assets_dir);
    if (!surface_has_ink(menu_s, "menu.svg")) failures++;

    mark();
    cairo_surface_t *ad_s = render_ad(&m, assets_dir);
    if (!surface_has_ink(ad_s, "ad.svg")) failures++;

    /* Основа попапу окремо від накладання: основа рендериться раз на старті
     * кіоска, а накладання — на кожен бонус, тобто на очах у клієнта. */
    popup_art_t art = {0};
    mark();
    popup_art_init(&art, assets_dir);
    if (!surface_has_ink(art.base, "popup: основа")) failures++;

    /* Обидва варіанти попапу: з плиткою предмета й без — це різні шляхи
     * підстановки (popup_secret.svg або порожньо), і зламатись може кожен. */
    bonus_popup_t bp = { .coins = 100, .secret = true };
    snprintf(bp.qr_payload, sizeof(bp.qr_payload), "https://extrovert.cafe/b/selftest");
    mark();
    cairo_surface_t *popup_s = popup_render(&art, assets_dir, &bp);
    if (!surface_has_ink(popup_s, "popup + предмет")) failures++;
    bp.secret = false;
    mark();
    cairo_surface_t *popup2_s = popup_render(&art, assets_dir, &bp);
    if (!surface_has_ink(popup2_s, "popup")) failures++;
    /* Плашка «Бонус отримано» — третій шлях: інший шаблон і власне полотно,
     * тож ламається окремо від двох попередніх. */
    bonus_popup_t taken = { .taken = true };
    mark();
    cairo_surface_t *taken_s = popup_render(&art, assets_dir, &taken);
    if (!surface_has_ink(taken_s, "popup: отримано")) failures++;
    popup_art_destroy(&art);

    mark();
    cairo_surface_t *qr_s = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, (int)QR_ROW_SIZE, (int)QR_ROW_SIZE);
    cairo_t *qr_cr = cairo_create(qr_s);
    if (!qr_paint(qr_cr, "https://extrovert.cafe/b/selftest", 0, 0, QR_ROW_SIZE)) failures++;
    cairo_destroy(qr_cr);
    if (!surface_has_ink(qr_s, "qr")) failures++;

    double banner_w = 0;
    mark();
    cairo_surface_t *banner_s = render_update_banner("ОНОВЛЕННЯ…", &banner_w);
    if (!surface_has_ink(banner_s, "update banner")) failures++;

    if (out_png && menu_s && cairo_surface_status(menu_s) == CAIRO_STATUS_SUCCESS) {
        /* Знімок саме меню: це найбільша й найскладніша поверхня, і саме
         * на неї дивляться, коли розбирають "чому оновлення не пройшло". */
        cairo_status_t st = cairo_surface_write_to_png(menu_s, out_png);
        if (st != CAIRO_STATUS_SUCCESS)
            fprintf(stderr, "selftest: не зберігся знімок %s (%s)\n",
                    out_png, cairo_status_to_string(st));
        else
            fprintf(stderr, "selftest: знімок у %s\n", out_png);
    }

    /* Попап — окремим знімком і лише на вимогу: апдейтеру вистачає меню, а
     * цей потрібен, щоб подивитись, як його малює саме Pi-шний librsvg 2.40
     * (десктопний контейнер має новіший і може сховати різницю). */
    const char *popup_png = getenv("SELFTEST_POPUP_PNG");
    if (popup_png && popup_png[0] && popup_s && cairo_surface_status(popup_s) == CAIRO_STATUS_SUCCESS)
        cairo_surface_write_to_png(popup_s, popup_png);
    const char *ad_png = getenv("SELFTEST_AD_PNG");
    if (ad_png && ad_png[0] && ad_s && cairo_surface_status(ad_s) == CAIRO_STATUS_SUCCESS)
        cairo_surface_write_to_png(ad_s, ad_png);
    const char *taken_png = getenv("SELFTEST_TAKEN_PNG");
    if (taken_png && taken_png[0] && taken_s && cairo_surface_status(taken_s) == CAIRO_STATUS_SUCCESS)
        cairo_surface_write_to_png(taken_s, taken_png);

    if (menu_s) cairo_surface_destroy(menu_s);
    if (ad_s) cairo_surface_destroy(ad_s);
    if (popup_s) cairo_surface_destroy(popup_s);
    if (popup2_s) cairo_surface_destroy(popup2_s);
    if (taken_s) cairo_surface_destroy(taken_s);
    if (qr_s) cairo_surface_destroy(qr_s);
    if (banner_s) cairo_surface_destroy(banner_s);

    if (failures) {
        fprintf(stderr, "selftest: ПРОВАЛЕНО, %d перевірок\n", failures);
        return 1;
    }
    fprintf(stderr, "selftest: усе добре\n");
    return 0;
}
