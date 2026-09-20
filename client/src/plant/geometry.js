// Геометрія куща: координати сцени, зони посадки, криві й перетворення
// «корінь спрайту → центр спрайту». Формули — ті самі, що в рушії дизайну
// (design/client «Gamification Screens», buildBaseComposite) і в редакторі
// зон; числа — docs/bush_planting_ui.md і assets/planting/placement.json.
//
// Тут немає React і немає fetch: усе, що можна порахувати без DOM, рахується
// тут — щоб і екран кавенятка, і екрани посадки міряли однією лінійкою.

export const W0 = 220;                 // базова ширина спрайту в сцені
export const STAGE_W = 1000;
export const STAGE_H = 1300;
export const GROUND_Y = 1120;
const GROWTH_START_SCALE = 0.55;
export const FRUIT_FOREGROUND_Z = 1000;
export const SPROUT_SCALE = 1.65;
export const SPROUT_GROUND_GAP = 17.7;
export const BRANCH_LOCAL = 512;       // криві бутонів задані в px спрайту гілки

export const TRUNK_TIER_FOR_STAGE = { 0: null, 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
export const TRUNK_TIER_FILE = {
  1: "trunk_tier1_thin.png", 2: "trunk_tier2_medium.png",
  3: "trunk_tier3_thick.png", 4: "trunk_tier4_thickest.png",
};
export const GRAVITY_DROOP = { sad: { pct: 0.30, fixedDeg: 18 }, withered: { pct: 0.55, fixedDeg: 35 } };
export const ART_SUFFIX = { sad: "sad", withered: "very_sad" };
export const BODY_MOOD_SUFFIX = { sad: "sad", withered: "withered" };
export const FILTER_KEY = { sad: "sad", withered: "very_sad" };

export const rad = (deg) => (deg * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

// Кущ росте зі стадією: усе, крім платформи, масштабується від точки ґрунту.
export function growthFactor(stage) {
  if (stage < 1) return 1;
  const s = Math.min(10, Math.max(1, stage));
  return GROWTH_START_SCALE + (1 - GROWTH_START_SCALE) * (Math.log(s) / Math.log(10));
}

export function applyGrowth(inst, anchor, f) {
  if (f === 1) return inst;
  return { ...inst, x: anchor.x + (inst.x - anchor.x) * f, y: anchor.y + (inst.y - anchor.y) * f, scale: inst.scale * f };
}

// Сумний кущ опускає листя до землі: кут тягнеться до 180°.
export function gravityDroop(rotation, mood) {
  const cfg = GRAVITY_DROOP[mood];
  if (!cfg) return rotation;
  const diff = (((180 - rotation) % 360) + 540) % 360 - 180;
  const droop = Math.max(Math.abs(diff) * cfg.pct, cfg.fixedDeg);
  return rotation + Math.sign(diff) * Math.min(droop, Math.abs(diff));
}

// ── корінь ↔ центр ─────────────────────────────────────────────────────
// Рушій малює спрайт центрованим на item.x/y, а гравець ставить КОРІНЬ
// (точку кріплення). Без цієї інверсії корінь тікає з обраної точки, щойно
// зміниться поворот чи розмір (docs/bush_planting_ui.md §2).
export function rootAnchorOffset(root, naturalW, naturalH, rotation, F) {
  const dx = (root.x - naturalW / 2) * F;
  const dy = (root.y - naturalH / 2) * F;
  const a = rad(rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function centerAnchorForRoot(rootStage, meta, rotation, scale) {
  const [nw, nh] = meta.natural;
  const off = rootAnchorOffset(meta.root, nw, nh, rotation, (W0 * scale) / nw);
  return { x: rootStage.x - off.x, y: rootStage.y - off.y };
}

// Будь-яка точка локального простору спрайту → сцена (для кривих бутонів,
// які задані в пікселях спрайту гілки).
export function transformLocalPoint(pt, naturalW, naturalH, item) {
  const F = (W0 * item.scale) / naturalW;
  const dx = (pt.x - naturalW / 2) * F, dy = (pt.y - naturalH / 2) * F;
  const a = rad(item.rotation || 0), c = Math.cos(a), s = Math.sin(a);
  return { x: item.x + dx * c - dy * s, y: item.y + dx * s + dy * c };
}

// ── зони ───────────────────────────────────────────────────────────────
export function pointInPolygon(poly, p) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// Кільце: всередині зовнішнього контуру й поза внутрішнім.
export const inAnnulus = (zone, p) =>
  pointInPolygon(zone.polygon, p) && !pointInPolygon(zone.holePolygon, p);

// Найближча точка зони — щоб тап трохи поза межами не був «нічим», а
// притягувався до краю (палець товстіший за пікселі).
export function clampToPolygon(poly, p) {
  let best = null, bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = closestOnSegment(poly[j], poly[i], p);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best ?? p;
}

function closestOnSegment(a, b, p) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  if (!len) return { ...a };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + vx * t, y: a.y + vy * t };
}

// ── криві ──────────────────────────────────────────────────────────────
// Catmull-Rom через опорні точки — та сама крива, що її малює smoothD, тому
// «повзунок по лінії» рухається рівно по намальованому.
function catmull(p, closed, samples = 24) {
  const n = p.length;
  const at = (i) => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const out = [{ ...p[0] }];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 1; s <= samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

// Крива з параметром t=0..1 за ДОВЖИНОЮ дуги: рівномірний крок пальця дає
// рівномірний рух по лінії, а не ривки на згинах.
export function makeCurve(points, { closed = false } = {}) {
  const pts = catmull(points, closed);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc.at(-1) || 1;

  const pointAt = (t) => {
    const target = Math.max(0, Math.min(1, t)) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < target) i++;
    const span = acc[i] - acc[i - 1] || 1;
    const k = (target - acc[i - 1]) / span;
    const a = pts[i - 1], b = pts[i];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, i };
  };

  const tangentAt = (t) => {
    const { i } = pointAt(t);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i)];
    return deg(Math.atan2(b.y - a.y, b.x - a.x));
  };

  // Найближче t до довільної точки — так тап по кривій стає позицією.
  const nearestT = (p) => {
    let best = 0, bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const q = closestOnSegment(pts[i - 1], pts[i], p);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        const span = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) || 1;
        const k = Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) / span;
        best = (acc[i - 1] + span * k) / total;
      }
    }
    return { t: best, distance: Math.sqrt(bestD) };
  };

  return { points: pts, total, pointAt, tangentAt, nearestT, closed, source: points };
}

// Нормаль до кривої, напрямлена геть від центра тіла.
export function outwardNormal(tangentDeg, point, center) {
  const n = tangentDeg + 90;
  const away = { x: point.x - center.x, y: point.y - center.y };
  const dot = Math.cos(rad(n)) * away.x + Math.sin(rad(n)) * away.y;
  return dot >= 0 ? n : n - 180;
}

export const normalFromCenter = (center, p) => deg(Math.atan2(p.y - center.y, p.x - center.x));

// ── svg-шляхи ──────────────────────────────────────────────────────────
const r1 = (v) => Math.round(v * 10) / 10;

export function smoothD(p, closed) {
  const n = p.length;
  if (n < 2) return "";
  const at = (i) => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${r1(p[0].x)} ${r1(p[0].y)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${r1(p1.x + (p2.x - p0.x) / 6)} ${r1(p1.y + (p2.y - p0.y) / 6)},`
      + `${r1(p2.x - (p3.x - p1.x) / 6)} ${r1(p2.y - (p3.y - p1.y) / 6)},`
      + `${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d + (closed ? "Z" : "");
}

// Рамка, у яку камера має вмістити і зону, і сам кущ.
export function fitCamera(points, viewport, pad = 26) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const k = Math.min(viewport.w / (x1 - x0), viewport.h / (y1 - y0));
  return {
    k,
    tx: viewport.x + viewport.w / 2 - ((x0 + x1) / 2) * k,
    ty: viewport.y + viewport.h / 2 - ((y0 + y1) / 2) * k,
  };
}
