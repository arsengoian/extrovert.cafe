// bake-drink-shadows.mjs — печемо тінь дзюрки прямо в PNG, один раз при
// імпорті ассетів у C-проєкт, замість рендерити її на кожному пристрої.
//
// Параметри тіні — з design/monitor-menu/monitor-menu.svg, <filter id=
// "cupShadow">: feDropShadow dx=0 dy=-14 stdDeviation=13 flood=#000@0.45.
// Навіщо не librsvg: Pi-шний librsvg (Stretch, ~2.40) вийшов задовго до
// того, як librsvg навчився feDropShadow (Rust-рушій фільтрів, ~2.50) —
// на пристрої фільтр мовчки не спрацював би. Навіщо не Cairo: у Cairo
// взагалі нема готового розмиття, тільки композитинг.
//
//   node tools/bake-drink-shadows.mjs
//
// Джерело: ../../../design/monitor-menu/assets/drinks/*.png — design/ поза
// git (CLAUDE.md), тому цей скрипт і є єдиним записаним шляхом, яким тінь
// потрапляє з макета в реальні ассети кіоска.
//
// stdDeviation/dx/dy в оригіналі задані відносно показу 222px завширшки —
// єдине місце в макеті, де фільтр застосований (герой-картинка рекламної
// панелі). Вихідні PNG значно ширші за 222px (це вихідники під будь-який
// розмір показу: мініатюра рядка бонусу, картка меню, герой), тож тінь
// масштабується пропорційно РЕАЛЬНІЙ ширині кожного файлу — інакше вона
// вийшла б помітно тоншою на 515px-широких файлах, ніж на 370px-широких.
//
// Два виходи, свідомо РІЗНІ теки — 29.08.2026, після того, як з'ясувалось,
// що макет застосовує тінь ЛИШЕ до герой-картинки реклами (єдине місце з
// filter="url(#cupShadow)"); картки меню й мініатюра рядка бонусу
// показують ту саму картинку через <image mask="url(#fadeMask)">, БЕЗ
// фільтра — їм потрібен ОРИГІНАЛ, інакше прозорі поля під тінь зіб'ють
// preserveAspectRatio/маску.
//
//   assets/drinks/       — оригінали (просто копія), для картки й рядка бонусу
//   assets/drinks-ad/     — з тінню й полями під розмиття, лише для героя реклами
//
// Ширший за оригінал файл iз тінню підставляється в ad.svg тим самим
// <image>-тегом, без filter; поля просто стають частиною зображення, яке
// preserveAspectRatio="xMidYMid meet" вписує в ту саму рамку, що й
// авторовано в макеті — розтяжки координат тут більше не треба
// (manifest.json, який раніше ніс поля для C-коду, теж прибрано: SVG-шлях
// не читає координати, лише посилається на готовий файл).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(here, "../../../design/monitor-menu/assets/drinks");
const DST_DIR = path.resolve(here, "../assets/drinks-ad");
const PLAIN_DIR = path.resolve(here, "../assets/drinks");

const DESIGN_DISPLAY_W = 222;   // ширина показу героя в SVG — під неї авторовано фільтр
const SIGMA_AT_DESIGN_W = 13;
const DX_AT_DESIGN_W = 0;
const DY_AT_DESIGN_W = -14;
const FLOOD_OPACITY = 0.45;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Box-блюр з ковзною сумою — O(w*h), не O(w*h*radius). Проганяємо тричі
// (гор./верт. по черзі), що є стандартним наближенням гаусового розмиття:
// формула d з SVG-специфікації feGaussianBlur.
function boxBlur1D(src, w, h, radius, horizontal) {
  const out = new Float32Array(w * h);
  const norm = 1 / (radius * 2 + 1);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        out[row + x] = sum * norm;
        sum += src[row + clamp(x + radius + 1, 0, w - 1)] - src[row + clamp(x - radius, 0, w - 1)];
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += src[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum * norm;
        sum += src[clamp(y + radius + 1, 0, h - 1) * w + x] - src[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
  }
  return out;
}

function gaussianApprox(alpha, w, h, sigma) {
  const d = Math.floor(sigma * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5);
  const radius = Math.max(1, Math.floor(d / 2));
  let out = alpha;
  for (let i = 0; i < 3; i++) {
    out = boxBlur1D(out, w, h, radius, true);
    out = boxBlur1D(out, w, h, radius, false);
  }
  return out;
}

function bakeOne(file) {
  const src = PNG.sync.read(fs.readFileSync(path.join(SRC_DIR, file)));
  const scale = src.width / DESIGN_DISPLAY_W;
  const sigma = SIGMA_AT_DESIGN_W * scale;
  const dx = Math.round(DX_AT_DESIGN_W * scale);
  const dy = Math.round(DY_AT_DESIGN_W * scale);
  const spread = Math.ceil(sigma * 3);   // 3-сигма радіус розмиття
  const padL = spread + Math.max(0, -dx);
  const padR = spread + Math.max(0, dx);
  const padT = spread + Math.max(0, -dy);
  const padB = spread + Math.max(0, dy);

  const w = src.width + padL + padR;
  const h = src.height + padT + padB;

  // Альфа джерела, зсунута на (dx,dy), у координатах доповненого канвасу —
  // саме це розмиваємо, щоб отримати форму тіні.
  const shAlpha = new Float32Array(w * h);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const a = src.data[(y * src.width + x) * 4 + 3] / 255;
      if (a === 0) continue;
      const dxp = x + padL + dx, dyp = y + padT + dy;
      if (dxp >= 0 && dxp < w && dyp >= 0 && dyp < h) shAlpha[dyp * w + dxp] = a;
    }
  }
  const blurred = gaussianApprox(shAlpha, w, h, sigma);

  const out = new PNG({ width: w, height: h });
  out.data.fill(0);

  // 1. тінь: чорний (RGB лишається 0 з fill вище), альфа = розмита * flood-opacity
  for (let i = 0; i < w * h; i++) {
    const a = blurred[i] * FLOOD_OPACITY;
    if (a > 0) out.data[i * 4 + 3] = Math.round(clamp(a, 0, 1) * 255);
  }

  // 2. оригінал зверху — звичайний source-over у прямому (не premultiplied) alpha
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const sa = src.data[si + 3] / 255;
      if (sa === 0) continue;
      const di = ((y + padT) * w + (x + padL)) * 4;
      const da = out.data[di + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const sc = src.data[si + c] / 255;
        const dc = out.data[di + c] / 255;
        out.data[di + c] = Math.round(clamp((sc * sa + dc * da * (1 - sa)) / outA, 0, 1) * 255);
      }
      out.data[di + 3] = Math.round(outA * 255);
    }
  }

  fs.mkdirSync(DST_DIR, { recursive: true });
  fs.writeFileSync(path.join(DST_DIR, file), PNG.sync.write(out));
  return { padL, padT, padR, padB };
}

if (!fs.existsSync(SRC_DIR)) {
  console.error("немає " + SRC_DIR + " — design/ лежить поза git, звір шлях");
  process.exit(1);
}
const files = fs.readdirSync(SRC_DIR).filter((f) => f.toLowerCase().endsWith(".png"));
fs.mkdirSync(PLAIN_DIR, { recursive: true });
for (const f of files) {
  const m = bakeOne(f);
  console.log("тінь: " + f + " поля L" + m.padL + " T" + m.padT + " R" + m.padR + " B" + m.padB);
  fs.copyFileSync(path.join(SRC_DIR, f), path.join(PLAIN_DIR, f));
}
console.log(files.length + " файлів: " + DST_DIR + " (з тінню, для героя) і " + PLAIN_DIR + " (оригінал, для картки/рядка)");
