// Прев'ю панелі акції — те саме, що побачить екран точки, у масштабі 1:1.
//
// Головне рішення: беремо НЕ копію шаблона, а сам файл кіоска
// (raspberry/kiosk/assets/templates/ad.svg, його кладе в public/
// scripts/copy-kiosk-assets.mjs). Тому геометрія збігається за побудовою, а
// не за уважністю: правка шаблона змінює обидві картинки одночасно.
//
// Що доводиться повторювати вручну — арифметика з render.c: ширина пігулки
// від виміряного тексту й підйом текстового блоку, коли мітки немає. Це
// єдине місце розходження, тож константи нижче мають ті самі імена, що в
// raspberry/kiosk/src/config.h — щоб grep знаходив обидва разом.
//
// Наскільки це точно (перевірено 25.09.2026 звіркою з тим, що намалював
// кіоск): координати, розміри, шрифти й картинка — збігаються повністю, бо
// це той самий файл. Розходиться ширина плашки: браузер міряє «АКЦІЯ» у
// 44.8 px, Pango на точці — у 44 (хінтинг притискає ширину гліфів до цілих
// пікселів, браузер ні). На трьох міток різниця була +0.8, +0.2 і −1.2 px.
// Практичний наслідок один: рівно на межі обрізання довгий заголовок може
// розійтись на символ. Це сказано й у підписі під прев'ю — прев'ю, яке
// мовчки бреше на межі, гірше за прев'ю, яке про цю межу попереджає.
import { useEffect, useRef, useState } from "react";

/* config.h: AD_PILL_* / AD_NOPILL_SHIFT / AD_HEAD_* */
const PILL_X = 26.0;
const PILL_PAD = 13.5;
const PILL_TRACKING = 1.4;
const PILL_FONT_SIZE = 14;
const NOPILL_SHIFT = 36.2;
const HEAD_FONT_SIZE = 31;
const HEAD_MAX_W = 418.0;

/* backend/lib/src/menu.js: PROMO_LABEL */
const LABELS = { promo: "АКЦІЯ", notice: "ОГОЛОШЕННЯ", news: "НОВИНА", none: "" };

const TPL_URL = "/assets/kiosk/templates/ad.svg";
const HERO_DIR = "/assets/kiosk/drinks-ad";
// Без напою кіоск підставляє шлях до неіснуючого none.png, і librsvg просто
// нічого не малює. Браузер на місці ненайденої картинки малює свою іконку
// «зламано» — тобто показував би те, чого на екрані точки не буде. Прозорий
// піксель дає рівно той самий результат, що й на точці: порожнє місце.
const HERO_NONE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let canvas = null;
function measure(text, font) {
  if (!text) return 0;
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}

// Той самий алгоритм, що svgtpl_ellipsize: ріжемо з кінця по код-поінту,
// поки з «…» не влізе. Масив [...text] дає саме код-поінти, не байти.
function ellipsize(text, font, maxW) {
  if (!text || measure(text, font) <= maxW) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = chars.slice(0, n).join("") + "…";
    if (measure(cut, font) <= maxW) return cut;
  }
  return "…";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function AdPreview({ kind, head1, head2, sub, fine, sprite }) {
  const [tpl, setTpl] = useState(null);
  const [ready, setReady] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    fetch(TPL_URL).then((r) => r.text()).then(setTpl).catch(() => setTpl(""));
    // Міряти текст до завантаження шрифтів не можна: canvas мовчки візьме
    // запасний, і пігулка вийде іншої ширини, ніж на точці.
    Promise.all([
      document.fonts.load(`${PILL_FONT_SIZE}px Extro700`),
      document.fonts.load(`${HEAD_FONT_SIZE}px Extro1000`),
    ]).then(() => setReady(true)).catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!tpl || !ready || !box.current) return;

    const label = LABELS[kind] ?? "";
    let pillW = 0;
    if (label) {
      const w = measure(label, `${PILL_FONT_SIZE}px Extro700`);
      pillW = w + [...label].length * PILL_TRACKING + 2 * PILL_PAD;
    }
    const headFont = `${HEAD_FONT_SIZE}px Extro1000`;
    const vals = {
      PROMO_LABEL: esc(label),
      HEAD1: esc(ellipsize(head1 ?? "", headFont, HEAD_MAX_W)),
      HEAD2: esc(ellipsize(head2 ?? "", headFont, HEAD_MAX_W)),
      SUB: esc(sub ?? ""),
      FINE: esc(fine ?? ""),
      HERO_IMG: sprite ? `${HERO_DIR}/${sprite}.png` : HERO_NONE,
      PILL_W: pillW.toFixed(1),
      PILL_CX: (PILL_X + pillW / 2).toFixed(1),
      TEXT_DY: (pillW > 0 ? 0 : -NOPILL_SHIFT).toFixed(1),
    };
    box.current.innerHTML = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => vals[k] ?? m);
  }, [tpl, ready, kind, head1, head2, sub, fine, sprite]);

  return <div className="ad-preview" ref={box} />;
}
