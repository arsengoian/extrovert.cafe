// Складання сцени кавенятка: базові шари (платформа, стовбур, тіло, обличчя,
// дві фіксовані «руки») беруться з еталонного макета tree_layout.json, а
// листя, гілки й бутони — з appearance самого гравця (db-schema §0).
//
// Той самий список інстансів малює і головний екран, і екрани посадки:
// різниця лише в тому, що на посадці зверху лягає ще чернетка й підсвічена
// зона. Якщо ці два шляхи розійдуться, гравець побачить одне на посадці й
// інше після неї — тому вони тут єдині.
import {
  ART_SUFFIX, BODY_MOOD_SUFFIX, FRUIT_FOREGROUND_Z, GROUND_Y, SPROUT_GROUND_GAP,
  SPROUT_SCALE, STAGE_W, TRUNK_TIER_FILE, TRUNK_TIER_FOR_STAGE, W0,
  applyGrowth, gravityDroop, growthFactor,
} from "./geometry.js";

export const ANCHOR = { x: STAGE_W / 2, y: GROUND_Y };

const LEAF_GROUP = "leaves_batch_normal";
const BRANCH_GROUP = "branch_skins_custom";
const FRUIT_GROUP = "fruit_bud_greenbean";

// Шари, які кавенятку дає макет, а не гравець.
const BASE_GROUPS = new Set([
  "platform", "ground_shadow", "trunk_tiers", "body_stage1_sphere",
  "face_setA_normal", "branch_arms_fixed",
]);

export const leafSprite = (skin, mood) =>
  `leaf_skin${skin}_${mood === "withered" ? "very_sad" : mood === "sad" ? "sad" : "normal"}.png`;
export const leafGroup = (mood) => `leaves_batch_${ART_SUFFIX[mood] ?? "normal"}`;
export const branchSprite = (skin, mood) =>
  `branch_custom_skin${skin}${mood === "withered" ? "_withered" : mood === "sad" ? "_sad" : ""}.png`;
export const branchGroup = (mood) => (mood === "healthy" ? BRANCH_GROUP : `${BRANCH_GROUP}_${BODY_MOOD_SUFFIX[mood]}`);

// Плід тієї самої точки по стадіях: бутон → квітка → зелений біб → стиглий.
export function fruitSprite(stage, i) {
  if (stage <= 7) return [FRUIT_GROUP, "fruit_bud.png"];
  if (stage === 8) return ["fruit_flower_skins", `fruit_flower_skin${(i % 5) + 1}.png`];
  if (stage === 9) return [FRUIT_GROUP, "fruit_green_bean.png"];
  return ["fruit_ripebean_skins", `fruit_ripebean_skin${(i % 5) + 1}.png`];
}

// Скільки бутонів уже має бути видно на стадії (economy §3.2).
export function budsForStage(stage) {
  if (stage < 4) return 0;
  if (stage === 4) return 1;
  if (stage === 5) return 3;
  if (stage === 6) return 5;
  return 7;
}

// Настрій змінює спрайт, а не позицію: тіло, обличчя й руки мають власні
// версії, листя ще й провисає під власною вагою.
function moodBase(inst, mood) {
  if (mood === "healthy") return [{ ...inst }];
  const suffix = BODY_MOOD_SUFFIX[mood] ?? mood;
  const art = ART_SUFFIX[mood] ?? mood;

  if (inst.group === "body_stage1_sphere") {
    return [{ ...inst, group: "body_stage1_sphere_moods", sprite: `body_stage1_sphere_${suffix}.png` }];
  }
  if (inst.group === "branch_arms_fixed") {
    return [{ ...inst, group: `branch_arms_fixed_${suffix}`, sprite: inst.sprite.replace(".png", `_${suffix}.png`) }];
  }
  if (inst.group === "face_setA_normal") {
    // У сумних наборах білок уже намальований у зіниці — окремого ока немає.
    if (inst.sprite.includes("_eye_")) return [];
    return [{ ...inst, group: `face_setA_${art}`, sprite: inst.sprite.replace("A_normal_", `A_${art}_`) }];
  }
  return [{ ...inst }];
}

// Зіниця сумного набору малюється на місці ока звичайного — інакше погляд
// «з'їжджає» (у макеті вони різного розміру).
function fixPupils(instances, layout, mood) {
  if (mood === "healthy") return instances;
  return instances.map((inst) => {
    if (!inst.sprite?.includes("_pupil_")) return inst;
    const side = inst.sprite.includes("_L") ? "L" : "R";
    const eye = layout.instances.find((i) => i.group === "face_setA_normal" && i.sprite.includes(`_eye_${side}`));
    return eye ? { ...inst, x: eye.x, y: eye.y, scale: eye.scale } : inst;
  });
}

// Базові шари під потрібну стадію: стовбур свого тіру, тіло, обличчя, руки.
export function baseInstances(layout, stage, mood) {
  const f = growthFactor(stage);
  const platform = layout.instances.find((i) => i.group === "platform");

  if (stage === 0) {
    const sprout = {
      group: "body_stage0_sprout", sprite: "body_stage0_sprout.png",
      x: ANCHOR.x, y: ANCHOR.y - SPROUT_GROUND_GAP - (W0 * SPROUT_SCALE) / 2,
      scale: SPROUT_SCALE, rotation: 0, z: 5,
    };
    return platform ? [{ ...platform }, sprout] : [sprout];
  }

  const tierFile = TRUNK_TIER_FILE[TRUNK_TIER_FOR_STAGE[stage]];
  const out = [];
  // Стадія 1 — тіло ще сидить на тонкому стовбурі й трохи підняте.
  let bodyShiftY = 0;
  if (stage === 1) {
    const trunk = layout.instances.find((i) => i.group === "trunk_tiers");
    if (trunk) bodyShiftY = 0.25 * (W0 * applyGrowth(trunk, ANCHOR, f).scale);
  }

  for (const inst of layout.instances) {
    if (!BASE_GROUPS.has(inst.group)) continue;
    if (inst.group === "branch_arms_fixed" && stage < 3) continue;
    for (const m of moodBase(inst, mood)) {
      if (m.group === "platform") { out.push({ ...m }); continue; }
      if (m.group === "trunk_tiers") {
        if (tierFile) out.push(applyGrowth({ ...m, sprite: tierFile }, ANCHOR, f));
        continue;
      }
      const grown = applyGrowth(m, ANCHOR, f);
      const shifted = bodyShiftY && /^(body_stage1|face_setA)/.test(m.group)
        ? { ...grown, y: grown.y + bodyShiftY }
        : grown;
      out.push(shifted);
    }
  }
  return fixPupils(out, layout, mood);
}

// Те, що посадив гравець. Координати в appearance — у зрілій сцені, як у
// макеті; сюди додається лише зростання під стадію.
export function playerInstances(appearance, stage, mood) {
  const f = growthFactor(stage);
  const a = appearance ?? {};
  const out = [];
  const grow = (item, extra) => applyGrowth({ ...item, ...extra }, ANCHOR, f);

  if (stage >= 2) {
    for (const l of a.leaves_bg ?? []) {
      out.push(grow(l, {
        group: leafGroup(mood), sprite: leafSprite(l.skin, mood),
        rotation: gravityDroop(l.rotation ?? 0, mood), z: 18,
      }));
    }
  }
  if (stage >= 3) {
    for (const b of a.branches ?? []) {
      out.push(grow(b, { group: branchGroup(mood), sprite: branchSprite(b.skin, mood), z: 41 }));
    }
  }
  if (stage >= 2) {
    for (const l of a.leaves_fg ?? []) {
      out.push(grow(l, {
        group: leafGroup(mood), sprite: leafSprite(l.skin, mood),
        rotation: gravityDroop(l.rotation ?? 0, mood), z: 53,
      }));
    }
  }

  // Бутони з'являються батчами: у даних їх стільки, скільки посаджено, але
  // показуємо не більше, ніж дозволяє стадія.
  const buds = (a.buds ?? []).slice(0, budsForStage(stage));
  buds.forEach((bud, i) => {
    const [group, sprite] = fruitSprite(stage, i);
    out.push(grow(bud, { group, sprite, z: FRUIT_FOREGROUND_Z + i }));
  });

  return out;
}

export function buildScene({ layout, appearance, stage, mood = "healthy", extra = [] }) {
  if (!layout) return [];
  return [...baseInstances(layout, stage, mood), ...playerInstances(appearance, stage, mood), ...extra]
    .sort((a, b) => a.z - b.z);
}
