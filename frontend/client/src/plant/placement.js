// Правила посадки для кожного типу елемента: де можна ставити, як рахується
// кут, які межі мають слайдери. Числа — з assets/planting/placement.json
// (docs/bush_planting_ui.md §3-§8), тут лише логіка навколо них.
//
// Головне, заради чого існує цей файл: перетворення «точка, яку торкнувся
// гравець» → готовий інстанс для рушія. Гравець ставить КОРІНЬ, рушій малює
// від ЦЕНТРА — між ними centerAnchorForRoot (§2).
import {
  BRANCH_LOCAL, centerAnchorForRoot, clampToPolygon, inAnnulus, makeCurve,
  normalFromCenter, outwardNormal, pointInPolygon, transformLocalPoint,
} from "./geometry.js";

export const LEAF_GROUP = "leaves_batch_normal";
export const BRANCH_GROUP = "branch_skins_custom";
export const BUD_GROUP = "fruit_bud_greenbean";

export const LEAF_SKINS = 9;
export const BRANCH_SKINS = 4;

export const spriteFor = (kind, item) =>
  kind === "branch" ? `branch_custom_skin${item.skin}.png`
  : kind === "bud" ? "fruit_bud.png"
  : `leaf_skin${item.skin}_normal.png`;

export const groupFor = (kind) =>
  kind === "branch" ? BRANCH_GROUP : kind === "bud" ? BUD_GROUP : LEAF_GROUP;

export const metaFor = (assets, kind, item) => assets.sprites[`${groupFor(kind)}:${spriteFor(kind, item)}`];

// Криві бутонів: тіло — одразу в координатах сцени, гілкові — у локальних
// пікселях спрайту, тому їх треба провести через ту саму трансформацію, що
// й сам інстанс гілки (§6).
export function budTargets(assets, branches) {
  const targets = [{ id: "body", label: "тіло", curve: makeCurve(assets.placement.budCurves.body) }];
  for (const branch of branches ?? []) {
    const sprite = `branch_custom_skin${branch.skin}.png`;
    const meta = assets.sprites[`${BRANCH_GROUP}:${sprite}`];
    const curves = assets.placement.budCurves.bySprite[sprite] ?? [];
    curves.forEach((curve, ci) => {
      const scene = curve.map((p) => transformLocalPoint(p, BRANCH_LOCAL, BRANCH_LOCAL, branch));
      targets.push({ id: `branch:${branch.id}:${ci}`, label: `гілка ${branch.id}`, curve: makeCurve(scene), meta });
    });
  }
  return targets;
}

// Конфіг типу: межі слайдерів, шар і спосіб позиціювання.
export function config(assets, kind) {
  const P = assets.placement;
  if (kind === "leafBg") {
    return { kind, mode: "area", zone: P.leafBg, rotation: P.leafBg.rotationOffset, scale: P.leafBg.scale, z: 18,
             normalCenter: P.leafBg.normalCenter, skins: LEAF_SKINS, group: LEAF_GROUP };
  }
  if (kind === "leafFg") {
    return { kind, mode: "area", zone: { polygon: P.leafFg.polygon }, free360: true,
             rotation: { min: 0, max: 359, default: P.leafFg.rotationDefault ?? 0 },
             scale: P.leafFg.scale, z: 53, skins: LEAF_SKINS, group: LEAF_GROUP };
  }
  if (kind === "branch") {
    return { kind, mode: "curve", curve: makeCurve(P.branch.path), edgeBlock: P.branch.edgeBlock,
             rotation: P.branch.rotationOffset, scale: P.branch.scale, z: 41,
             normalCenter: P.branch.normalCenter, skins: BRANCH_SKINS, group: BRANCH_GROUP };
  }
  return { kind, mode: "curves", edgeBlock: P.bud.edgeBlock, rotation: P.bud.rotationOffset,
           scale: P.bud.scale, z: 55, skins: 0, group: BUD_GROUP, normalCenter: P.leafBg.normalCenter };
}

export const clampT = (t, edgeBlock) => Math.max(edgeBlock, Math.min(1 - edgeBlock, t));

// Точка кореня для елемента: у зоні — сама точка, на кривій — точка при t.
export function rootOf(item, cfg, targets) {
  if (cfg.mode === "area") return { x: item.rx, y: item.ry };
  const curve = cfg.mode === "curve" ? cfg.curve : targets?.find((t) => t.id === item.owner)?.curve;
  return curve ? curve.pointAt(item.t) : { x: 0, y: 0 };
}

// Кут, під яким елемент реально лежить у сцені (ще без поправки на спрайт).
function finalAngle(item, cfg, root, targets) {
  if (cfg.free360) return item.angle ?? 0;
  if (cfg.mode === "area") return normalFromCenter(cfg.normalCenter, root) + (item.offset ?? 0);
  const curve = cfg.mode === "curve" ? cfg.curve : targets?.find((t) => t.id === item.owner)?.curve;
  if (!curve) return item.offset ?? 0;
  return outwardNormal(curve.tangentAt(item.t), root, cfg.normalCenter) + (item.offset ?? 0);
}

// Авторський запис → те, що малює рушій (center-anchored).
export function resolve(item, { assets, cfg, targets }) {
  const meta = metaFor(assets, cfg.kind === "leafFg" ? "leafBg" : cfg.kind, item);
  const root = rootOf(item, cfg, targets);
  const rotation = finalAngle(item, cfg, root, targets) - (meta?.angle ?? 0);
  const center = meta ? centerAnchorForRoot(root, meta, rotation, item.scale) : root;
  return {
    ...item,
    x: Math.round(center.x * 100) / 100,
    y: Math.round(center.y * 100) / 100,
    rotation: Math.round(rotation * 100) / 100,
    scale: Math.round(item.scale * 1000) / 1000,
    root: { x: Math.round(root.x * 10) / 10, y: Math.round(root.y * 10) / 10 },
  };
}

// Чи можна поставити корінь у цю точку — і куди його підтягнути, якщо палець
// трохи промазав повз межу зони.
export function snapToZone(point, cfg) {
  if (cfg.kind === "leafBg") {
    if (inAnnulus(cfg.zone, point)) return point;
    if (pointInPolygon(cfg.zone.holePolygon, point)) return clampToPolygon(cfg.zone.holePolygon, point);
    return clampToPolygon(cfg.zone.polygon, point);
  }
  if (pointInPolygon(cfg.zone.polygon, point)) return point;
  return clampToPolygon(cfg.zone.polygon, point);
}

// Новий елемент у точці дотику, зі значеннями слайдерів за замовчуванням.
export function createAt(point, cfg, { skin = 1, targets } = {}) {
  if (cfg.mode === "area") {
    const p = snapToZone(point, cfg);
    return cfg.free360
      ? { skin, rx: p.x, ry: p.y, angle: cfg.rotation.default, scale: cfg.scale.default }
      : { skin, rx: p.x, ry: p.y, offset: cfg.rotation.default, scale: cfg.scale.default };
  }
  if (cfg.mode === "curve") {
    const { t } = cfg.curve.nearestT(point);
    return { skin, t: clampT(t, cfg.edgeBlock), offset: cfg.rotation.default, scale: cfg.scale.default };
  }
  // Бутон: жест одночасно обирає й хазяїна (найближчу криву), і позицію.
  let best = null;
  for (const target of targets) {
    const hit = target.curve.nearestT(point);
    if (!best || hit.distance < best.distance) best = { ...hit, owner: target.id };
  }
  return { owner: best.owner, t: clampT(best.t, cfg.edgeBlock), offset: cfg.rotation.default, scale: cfg.scale.default };
}

// Перетягування вже поставленого елемента.
export function moveTo(item, point, cfg, targets) {
  if (cfg.mode === "area") {
    const p = snapToZone(point, cfg);
    return { ...item, rx: p.x, ry: p.y };
  }
  if (cfg.mode === "curve") {
    return { ...item, t: clampT(cfg.curve.nearestT(point).t, cfg.edgeBlock) };
  }
  let best = null;
  for (const target of targets) {
    const hit = target.curve.nearestT(point);
    if (!best || hit.distance < best.distance) best = { ...hit, owner: target.id };
  }
  return { ...item, owner: best.owner, t: clampT(best.t, cfg.edgeBlock) };
}
