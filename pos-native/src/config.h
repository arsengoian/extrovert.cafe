/* config.h — геометрія й кольори, скопійовані з pos/public/style.css.
 *
 * Навмисно НЕ парсимо CSS. Значення нижче — константи для кіоска 1920×1080,
 * який ніколи не змінює розмір, тому це не дублювання логіки, а одноразова
 * виписка чисел. Якщо колись style.css розʼїдеться з цим файлом — розбіжність
 * буде видно на очах при порівнянні зі скріншотом, а не мовчки зламає щось.
 */
#ifndef POS_NATIVE_CONFIG_H
#define POS_NATIVE_CONFIG_H

#define STAGE_W 1920
#define STAGE_H 1080

/* #head, #logo — style.css:11-12 */
#define HEAD_X 52
#define HEAD_Y 40
#define LOGO_W 640
#define LOGO_H 128

/* #grid — style.css:15 */
#define GRID_X 52
#define GRID_Y 232
#define GRID_COLS 4
#define GRID_ROWS 3
#define CARD_W 290
#define CARD_H 248
#define CARD_GAP_X 16
#define CARD_GAP_Y 18
#define CARD_MAX 12

/* .card — style.css:17-22 */
#define CARD_RADIUS 16.0
#define CARD_BG_R (0x17/255.0)
#define CARD_BG_G (0x1A/255.0)
#define CARD_BG_B (0x1F/255.0)
#define CARD_BORDER_A 0.07
#define CARD_TOPBAR_H 3.0

/* .badge — style.css:25 */
#define BADGE_SIZE 62.0
#define BADGE_R 12.0
#define BADGE_TOP 12.0
#define BADGE_COLOR_R (0xFE/255.0)
#define BADGE_COLOR_G (0x81/255.0)
#define BADGE_COLOR_B (0x0B/255.0)

/* .cup / .body / .liq / .foam / .rim — style.css:37-42
 * Координати відносні до лівого верхнього кута .cup, який сам стоїть
 * top:24px, left:50%-52px відносно картки. */
#define CUP_X_OFFSET (CARD_W/2.0 - 52.0)
#define CUP_Y_OFFSET 24.0
#define CUP_W 104.0
#define CUP_H 120.0
#define CUP_BODY_Y 8.0
#define CUP_BODY_SIZE 104.0
#define CUP_BODY_R (0xF7/255.0)
#define CUP_BODY_G (0xF1/255.0)
#define CUP_BODY_B (0xE6/255.0)
#define CUP_LIQ_X 9.0
#define CUP_LIQ_Y 22.0
#define CUP_LIQ_W 86.0
#define CUP_LIQ_H 84.0
#define CUP_FOAM_Y 18.0
#define CUP_FOAM_H 15.0
#define CUP_FOAM_R (0xEE/255.0)
#define CUP_FOAM_G (0xE2/255.0)
#define CUP_FOAM_B (0xCE/255.0)
#define CUP_RIM_X (-2.0)
#define CUP_RIM_Y 1.0
#define CUP_RIM_W 108.0
#define CUP_RIM_H 16.0

/* .name / .vol — style.css:30,32 */
#define NAME_X 18.0
#define NAME_BOTTOM 40.0
#define VOL_X 18.0
#define VOL_BOTTOM 12.0
#define TEXT_MUTED_R (0x8B/255.0)
#define TEXT_MUTED_G (0x94/255.0)
#define TEXT_MUTED_B (0xA3/255.0)

/* #side — style.css:44 */
#define SIDE_X 1330
#define SIDE_Y 40
#define SIDE_W 544
#define SIDE_H 1000
#define SIDE_R 20.0
#define SIDE_BG_R (0x17/255.0)
#define SIDE_BG_G (0x1A/255.0)
#define SIDE_BG_B (0x1F/255.0)

/* #howto — style.css:46 */
#define HOWTO_X 26
#define HOWTO_Y 32
#define HOWTO_W (SIDE_W - 52)
#define HOWTO_H 62
#define HOWTO_R 12.0

/* #stage background — style.css:10 */
#define STAGE_BG_R (0x0C/255.0)
#define STAGE_BG_G (0x0E/255.0)
#define STAGE_BG_B (0x11/255.0)
#define TEXT_FG_R (0xF2/255.0)
#define TEXT_FG_G (0xEF/255.0)
#define TEXT_FG_B (0xE6/255.0)

/* #qrbox — style.css:64 */
#define QRBOX_X 34
#define QRBOX_Y 742
#define QR_SIZE 182

/* Шрифти — файли, а не base64 з CSS; копії з design/brandbook/fonts */
#define FONT_400 "Extro400"
#define FONT_600 "Extro600"
#define FONT_700 "Extro700"
#define FONT_900 "Extro900"

/* ── анімації — точні цифри з keyframes у style.css (рівень 2 і попап) ── */
/* cupFloat — style.css:120-122: 0%,100%{y:0} 50%{y:-4px}, 3.2s ease-in-out infinite */
#define ANIM_CUP_PERIOD_S 3.2
#define ANIM_CUP_AMPLITUDE_PX 4.0
/* зсув фаз по nth-child(3n+1/+2/+3n) — style.css:124-126: 0s / -1.1s / -2.2s */
#define ANIM_CUP_PHASE_STAGGER_S 1.1

/* popIn/popOut — style.css: .34s ease-out / .28s ease-in */
#define ANIM_POPUP_IN_S 0.34
#define ANIM_POPUP_OUT_S 0.28
#define POPUP_W 760.0
#define POPUP_H 197.4
#define POPUP_R 28.0
#define POPUP_BG_A 0.94

#endif
