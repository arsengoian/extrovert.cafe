// PNG для друку на чашці й футболці (власник, 01.10.2026): той самий кущ,
// що на головному екрані, але на прозорому тлі, без платформи й тіні під
// нею і у великій роздільності. Малюємо на canvas з тих самих інстансів
// (buildScene) і спрайтів — інакше на чашці опинилось би не те кавенятко,
// яке гравець бачив, коли замовляв.
//
// Друк завжди «здорового» куща: сумний вигляд — стан дня, а не те, що
// людина хоче на чашці. Пориву вітру, звісно, теж немає.
import { W0 } from "./geometry.js";
import { buildScene } from "./scene.js";
import { loadPlantAssets } from "./assets.js";

// Довша сторона полотна до обрізки. Після обрізки по самому кущу лишається
// ≈3000 px — це ≈25 см при 300 dpi: більше за зону друку і чашки (220 мм по
// колу), і футболки (300 мм). Більше не варто: iOS не дає canvas понад
// ≈16,7 Мпікс.
const LONG_SIDE = 3400;
const PAD = 0.04;
const MARGIN = 0.02;   // поле довкола куща в готовому файлі, від довшої сторони

const SKIP = new Set(["platform", "ground_shadow"]);
const shadowed = (g) => /leaf|leav|branch|^fruit_/i.test(g || "");

function image(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // одного листка без файла не варто весь принт
    img.src = src;
  });
}

// Зіниця наборів B–E обрізана білком свого ока (clipTo, як mask-image у
// Scene.jsx): малюємо її на окреме полотно й лишаємо тільки те, що під
// білком. Без повороту — так деталі обличчя й розставлені.
function clipped(img, b, mask, maskImg, k) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b.w * k));
  c.height = Math.max(1, Math.round(b.h * k));
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0, c.width, c.height);
  cx.globalCompositeOperation = "destination-in";
  cx.drawImage(maskImg,
    (mask.inst.x - mask.w / 2 - (b.inst.x - b.w / 2)) * k, (mask.inst.y - mask.h / 2 - (b.inst.y - b.h / 2)) * k,
    mask.w * k, mask.h * k);
  return c;
}

/**
 * Знімок кавенятка → PNG (Blob). snapshot — те, що сервер зберіг у
 * замовленні: { growth_stage, appearance, worn, face_set_id }.
 */
export async function renderPrint(snapshot) {
  const assets = await loadPlantAssets();
  const instances = buildScene({
    layout: assets.layout,
    appearance: snapshot.appearance,
    stage: snapshot.growth_stage,
    mood: "healthy",
    worn: snapshot.worn,
    // Знімки до 02.10.2026 номера набору не мають — тоді обличчя A, як і
    // бачив гравець, коли замовляв.
    faceSet: snapshot.face_set_id ?? 1,
  }).filter((i) => i.sprite && !SKIP.has(i.group));

  // Розмір кожного спрайта — з sizes.json, як у Scene.jsx; межі — повернутого
  // прямокутника. Прозорі поля всередині спрайтів зріже обрізка в кінці.
  const boxes = instances.map((inst) => {
    const w = W0 * inst.scale;
    const size = assets.sizes?.[`${inst.group}/${inst.sprite}`];
    const h = size ? (w * size[1]) / size[0] : w;
    const a = ((inst.rotation ?? 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    return { inst, w, h, ex: (w * c + h * sn) / 2, ey: (w * sn + h * c) / 2 };
  });
  const minX = Math.min(...boxes.map((b) => b.inst.x - b.ex));
  const maxX = Math.max(...boxes.map((b) => b.inst.x + b.ex));
  const minY = Math.min(...boxes.map((b) => b.inst.y - b.ey));
  const maxY = Math.max(...boxes.map((b) => b.inst.y + b.ey));
  const bw = maxX - minX, bh = maxY - minY;
  const k = (LONG_SIDE * (1 - 2 * PAD)) / Math.max(bw, bh);
  const width = Math.round(bw * k / (1 - 2 * PAD));
  const height = Math.round(bh * k / (1 - 2 * PAD));
  const ox = (width - bw * k) / 2 - minX * k;
  const oy = (height - bh * k) / 2 - minY * k;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";

  const shadow = { offsetX: 6, offsetY: 6, blur: 6, opacity: 0.8, ...(assets.layout.shadow ?? {}) };
  const images = await Promise.all(boxes.map((b) => image(`/assets/sprites/${b.inst.group}/${b.inst.sprite}`)));
  const indexOf = new Map(boxes.map((b, n) => [`${b.inst.group}/${b.inst.sprite}`, n]));
  boxes.forEach((b, n) => {
    let img = images[n];
    if (!img) return;
    if (b.inst.clipTo) {
      const m = indexOf.get(`${b.inst.group}/${b.inst.clipTo}`);
      if (m !== undefined && images[m]) img = clipped(img, b, boxes[m], images[m], k);
    }
    ctx.save();
    // Тінь листя, гілок і плодів — як drop-shadow у Scene.jsx, у масштабі файла.
    if (shadow.enabled !== false && shadowed(b.inst.group)) {
      ctx.shadowColor = `rgba(15,12,4,${shadow.opacity})`;
      ctx.shadowOffsetX = shadow.offsetX * k;
      ctx.shadowOffsetY = shadow.offsetY * k;
      ctx.shadowBlur = shadow.blur * k;
    }
    ctx.globalAlpha = b.inst.opacity ?? 1;
    ctx.translate(ox + b.inst.x * k, oy + b.inst.y * k);
    ctx.rotate(((b.inst.rotation ?? 0) * Math.PI) / 180);
    ctx.drawImage(img, (-b.w * k) / 2, (-b.h * k) / 2, b.w * k, b.h * k);
    ctx.restore();
  });

  const out = trim(canvas);
  return new Promise((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("print_render_failed"))), "image/png"));
}

// Обрізка по непрозорому: друкарня ставить файл по його краях, і порожнє
// поле довкола куща зменшувало б саме кавенятко на чашці. Межі шукаємо на
// зменшеній копії (300 px) — так не треба читати всі 10 Мпікс полотна.
function trim(canvas) {
  const s = 300 / Math.max(canvas.width, canvas.height);
  const small = document.createElement("canvas");
  small.width = Math.ceil(canvas.width * s);
  small.height = Math.ceil(canvas.height * s);
  const sc = small.getContext("2d");
  sc.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = sc.getImageData(0, 0, small.width, small.height);
  let x0 = small.width, y0 = small.height, x1 = -1, y1 = -1;
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      if (data[(y * small.width + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return canvas;
  const pad = MARGIN * Math.max(canvas.width, canvas.height);
  const left = Math.max(0, Math.floor((x0 - 1) / s - pad));
  const top = Math.max(0, Math.floor((y0 - 1) / s - pad));
  const right = Math.min(canvas.width, Math.ceil((x1 + 2) / s + pad));
  const bottom = Math.min(canvas.height, Math.ceil((y1 + 2) / s + pad));
  const out = document.createElement("canvas");
  out.width = right - left;
  out.height = bottom - top;
  out.getContext("2d").drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Намалювати й залити за підписаним посиланням; true — якщо доїхало. */
export async function uploadPrint(snapshot, url) {
  if (!url) return false;
  const blob = await renderPrint(snapshot);
  const res = await fetch(url, { method: "PUT", headers: { "content-type": "image/png" }, body: blob });
  return res.ok;
}
