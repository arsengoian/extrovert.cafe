/* config.h — числа, яких не несе сама SVG-розмітка.
 *
 * Редизайн 29.08.2026: меню, реклама й фон рядків бонусів більше не
 * малюються вручну Cairo-викликами з передрукованими координатами —
 * вони йдуть зі справжніх SVG-шаблонів (assets/templates/, svgtpl.c/h),
 * адаптованих із design/monitor-menu/. Той підхід, що
 * був до цього (переписати кожне число з макета в #define), і породив
 * два реальні баги того ж дня: заголовок реклами обрізало по слову
 * (Pango-рядок без "px" читав "31" як 31 ПУНКТ при 96dpi, тобто ~41px —
 * SVG-текст цієї помилки в принципі не має, font-size у SVG завжди CSS-
 * пікселі). Що лишається тут — те, що SVG сама не знає: як розкласти
 * змінну кількість карток/рядків по сцені, і геометрія того єдиного
 * елемента, який усе ще малює прямий Cairo (bonus.c: смуга прогресу,
 * що рухається щосекунди).
 */
#ifndef POS_NATIVE_CONFIG_H
#define POS_NATIVE_CONFIG_H

#define STAGE_W 1920
#define STAGE_H 1080

/* -------- сітка карток меню (assets/templates/menu.svg + card.svg) --------
 * 5×3, редизайн 29.08.2026 (було 4×3 зі старим макетом). Кроки виведені з
 * реальних translate() у монітор-меню.svg: колонка +276 (306-30), рядок
 * +312.67 (440.67-128) — обидва дають однаковий зазор 16px від CARD_W/H,
 * що і в старому дизайні, тому лишили ту саму назву. */
#define GRID_X 30.0
#define GRID_Y 128.0
#define GRID_COLS 5
#define GRID_ROWS 3
#define CARD_MAX (GRID_COLS * GRID_ROWS)
#define CARD_W 260.0
#define CARD_H 296.67
#define CARD_GAP_X 16.0
#define CARD_GAP_Y 16.0
/* назва в картці не переноситься й не обрізається самою SVG — виміряти й
 * ellipsize (svgtpl_ellipsize) до підстановки, як і назва в рядку бонусу.
 * Розмір шрифту тут — лише для цього вимірювання, сам шаблон font-size
 * задає незалежно (card.svg), два числа мають лишатись однаковими вручну. */
#define CARD_NAME_FONT_SIZE 20
#define CARD_NAME_MAX_W 232.0

/* "з бонусами" — темний оверлей + бейдж монет у лівому верхньому куті
 * (templates/card_bonus.svg замість card.svg, коли d->bonus_coins>0).
 * Ширина бейджа — той самий принцип, що монетна пігулка рядка бонусу:
 * рахуємо від виміряного тексту, бо в макеті два реальні приклади
 * (80→67.2px, 100→76.8px) явно НЕ дають однакового правого відступу —
 * скоріш за все підігнані руками під ці два конкретні числа, а не за
 * формулою, тож PAD_R тут — компроміс, а не точне відтворення обох. */
#define CARD_BADGE_X 12.5
#define CARD_BADGE_Y 12.5
#define CARD_BADGE_H 33.0
#define CARD_BADGE_ICON_PAD_L 9.5    /* 22 - 12.5 */
#define CARD_BADGE_ICON_SIZE 20.0
#define CARD_BADGE_ICON_TEXT_GAP 6.0 /* 48 - (22+20) */
#define CARD_BADGE_PAD_R 12.0
#define CARD_BADGE_FONT_SIZE 16

/* -------- реклама (assets/templates/ad.svg) -------- */
#define AD_Y 30.0
#define AD_H 390.0
/* заголовок Extro1000/31 — той самий ellipsize перед підстановкою, той
 * самий баг, що дав переповнення 29.08.2026, тепер закритий на C-боці,
 * не покладаючись, що зміст завжди влізе сам. Розмір шрифту тут — лише
 * для вимірювання, сам шаблон (ad.svg) задає font-size незалежно. */
#define AD_HEAD_FONT_SIZE 31
#define AD_HEAD_MAX_W 418.0   /* PANEL_W - 2*26 */

/* -------- права колонка: спільні координати композитингу -------- */
#define PANEL_X 1420
#define PANEL_W 470

/* -------- панель бонусів (assets/templates/bonus_header.svg,
 * bonus_empty.svg, bonus_row.svg) -------- */
#define BONUS_Y 440
#define BONUS_PANEL_H 610
#define BONUS_ROW_X 22.0          /* відносно панелі */
#define BONUS_ROW_Y0 55.0
#define BONUS_ROW_W 426.0
#define BONUS_ROW_H 157.0
#define BONUS_ROW_GAP 12.0
#define BONUS_MAX_VISIBLE 3        /* стільки рядків влазить у BONUS_PANEL_H */
#define BONUS_TTL_S 120.0          /* "протягом 2 хвилин" — monitor-menu-empty.svg */
#define BONUS_EMULATE_PERIOD_S 40.0

/* ── Вебсокет подій (ws.c) ──────────────────────────────────────────── */
/* Адреса за замовчуванням задається збіркою: десктопна ціль дивиться в
 * локальний ws, малинова — одразу в прод. Змінна WS_URL перебиває. */
#ifndef WS_DEFAULT_URL
#define WS_DEFAULT_URL "ws://127.0.0.1:3002/"
#endif
#define WS_CONNECT_TIMEOUT_S 10
/* Пінг рідший за типовий таймаут NAT (30-60 с), але частіший за нього ж на
 * домашніх роутерах — 25 с тримає зʼєднання й ловить мовчазний обрив. */
#define WS_PING_PERIOD_S 25.0
#define WS_IDLE_LIMIT_S 60.0
#define WS_MAX_PAUSE_S 30.0
/* Відхилений токен сам не полагодиться: пробувати щохвилини достатньо, щоб
 * кіоск ожив після заміни WS_TOKEN, і не настільки часто, щоб засмітити лог. */
#define WS_AUTH_RETRY_S 60.0

/* назва напою в рядку — той самий ellipsize; межа праворуч — ліва сторона
 * кільця (356-56=300), а не монетна пігулка: вони на різних вертикальних
 * смугах макета (пігулка нижче, назва вище) й не перетинаються */
#define BONUS_NAME_X 89.0
#define BONUS_NAME_FONT_SIZE 18
#define BONUS_NAME_MAX_W 199.0     /* 356 - 56 - 89 - 12 */

/* монетна пігулка — ШИРИНА рахується від виміряного тексту (може бути
 * 1-3 цифри), позиція фіксована; підставляється в {{COIN_PILL_W}} */
#define BONUS_COIN_ICON_SIZE 16.0
#define BONUS_COIN_PILL_PAD_L 8.5
#define BONUS_COIN_ICON_TEXT_GAP 5.0
#define BONUS_COIN_PILL_PAD_R 10.0
#define BONUS_COIN_FONT_SIZE 14

/* текст відліку — єдиний текстовий шматок рядка, що й далі рендериться
 * прямим Cairo (перепікається раз на секунду, не через SVG-шаблон): рядок
 * містить ЖИВЕ число, тож "готового" варіанта в шаблоні просто нема */
#define BONUS_COUNTDOWN_X 89.0
#define BONUS_COUNTDOWN_Y 98.0
#define BONUS_COUNTDOWN_FONT_SIZE 14

/* смуга прогресу — єдиний елемент, що рухається щокадру/щосекунди,
 * тому єдиний, що лишається прямим Cairo, а не шаблоном (bonus.c).
 * Трек (статичний) — частина bonus_row.svg; тут лише геометрія
 * заповнення, яке малюється зверху в тому самому місці. */
#define BONUS_BAR_X 14.0
#define BONUS_BAR_Y 137.0
#define BONUS_BAR_W 398.0
#define BONUS_BAR_H 6.0
#define BONUS_BAR_R 3.0

/* QR — вписаний у внутрішнє коло кільця (356,70 відносно рядка, r=52 з
 * bonus_row.svg); тиха зона є за рахунок різниці діаметрів кола й QR,
 * як і в макеті (64px код у 104px колі). */
#define QR_ROW_SIZE 64.0

/* -------- кольори бренду — потрібні там, де досі малює прямий Cairo:
 * смуга прогресу (градієнт url(#pill) з макета) і попап (нижче) -------- */
#define BADGE_COLOR_R (0xFE/255.0)
#define BADGE_COLOR_G (0x81/255.0)
#define BADGE_COLOR_B (0x0B/255.0)
#define ACCENT2_R (0xFF/255.0)
#define ACCENT2_G (0x2D/255.0)
#define ACCENT2_B (0x6F/255.0)
#define TEXT_FG_R (0xF2/255.0)
#define TEXT_FG_G (0xEF/255.0)
#define TEXT_FG_B (0xE6/255.0)
#define TEXT_MUTED_R (0x8B/255.0)
#define TEXT_MUTED_G (0x94/255.0)
#define TEXT_MUTED_B (0xA3/255.0)

/* -------- шрифти -------- */
/* Extro* — кожна вага своя "родина" (файл названо як окрему family),
 * тому в SVG-шаблонах теж пишемо font-family="Extro700" явно на кожному
 * text, а не покладаємось на успадкований font-family="Extro" з кореня +
 * font-weight — це не гарантовано розв'яжеться в ту саму родину. */
#define FONT_400 "Extro400"
#define FONT_600 "Extro600"
#define FONT_700 "Extro700"
#define FONT_900 "Extro900"
#define FONT_1000 "Extro1000"

/* Poppins — звичайний Google Fonts файл: ОДНА typographic family з
 * кількома вагами, тому тут навпаки покладаємось на fontconfig + звичайний
 * font-weight, і в C-коді (для вимірювання), і в SVG-шаблонах однаково. */
#define FONT_POPPINS "Poppins"

/* -------- попап: єдиний екран, що досі малюється вручну (bonus.c) —
 * дизайну під нього ще нема, тому шаблонити нічого. Ті самі POPUP_W/H/R,
 * що анімує main.c (POPUP_IN/SHOWN/OUT), незалежно від того, звідки взявся
 * вміст. -------- */
#define ANIM_POPUP_IN_S 0.34
#define ANIM_POPUP_OUT_S 0.28
/* Скільки тримати SHOWN, перш ніж САМ почати ховатись — без цього
 * бонус-попап (на відміну від демо-циклу/SIGUSR1) нічим не приховати:
 * bonus_tick_emulate() лише показує, а ніхто не додає g_popup_toggle
 * пізніше. Без авто-приховування перший-ліпший бонус назавжди застрягав
 * у SHOWN, і POPUP_HIDDEN-гвардія в main.c блокувала всі наступні. */
#define ANIM_POPUP_HOLD_S 4.0
#define POPUP_W 760.0
#define POPUP_H 197.4
#define POPUP_R 28.0
#define POPUP_BG_A 0.94
#define BONUS_POPUP_COIN_SIZE 72.0

/* -------- плашка "оновлення" в шапці (update.c, pi/stack/updater.sh) -------
 * Живе праворуч від лого (menu.svg: лого x=30..379, y=33..103), у вільній
 * смузі до рекламної панелі (PANEL_X=1420). Окрема маленька текстура, а не
 * перемальовка menu.svg: меню — 1920×1080 і рендериться лише при зміні
 * даних, а плашка спалахує посеред роботи й не варта перерендеру сцени. */
#define UPDATE_BANNER_X 400.0
#define UPDATE_BANNER_Y 48.0
#define UPDATE_BANNER_H 40.0
#define UPDATE_BANNER_R 20.0
#define UPDATE_BANNER_PAD_X 18.0
#define UPDATE_BANNER_FONT_SIZE 15
#define UPDATE_BANNER_MAX_W 420.0
/* Як часто перевіряти файл-прапорець. Це stat() раз на секунду, не читання:
 * дешевше за будь-який IPC і переживає перезапуск обох сторін, бо стан
 * лежить у файловій системі, а не в памʼяті процесу. */
#define UPDATE_POLL_PERIOD_S 1.0

#endif
