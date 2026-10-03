// Складання сцени кавенятка: базові шари (платформа, стовбур, тіло, обличчя,
// дві фіксовані «руки») беруться з еталонного макета tree_layout.json
// (обличчя наборів B–E — з face_sets_layout.json, див. ownFace), а листя,
// гілки й бутони — з appearance самого гравця (db-schema §0).
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

// Набір обличчя (bush_graphics_customization §10.2): plants.face_set_id
// 1…5 → набори A…E, обраний при створенні кавенятка й назавжди. Невідомий
// номер (наборів стане більше, а клієнт ще старий) — обличчя A.
export const FACE_SETS = ["A", "B", "C", "D", "E"];
export const faceSetLetter = (id) => FACE_SETS[(Number(id) || 1) - 1] ?? "A";

// Обличчя B–E — власна розкладка (assets/face_sets_layout.json, у макеті як
// layout.faceSets): у кожного набору своя форма очей, тож позиції й розміри
// деталей пораховані для нього окремо, а не взяті з набору A. Звичайний
// настрій — око з шарів: ціле око → білок → зіниця (обрізана білком, clipTo)
// → повіка, тому зіниця ховається під повіку. Сумний і зів'ялий — повне око
// одним спрайтом, як у A. null — набір A або для цього набору ще немає даних.
function ownFace(layout, faceSet, mood) {
  const letter = faceSetLetter(faceSet);
  if (letter === "A") return null;
  const entry = layout.faceSets?.[letter]?.[ART_SUFFIX[mood] ?? "normal"];
  return entry ? entry.instances.map((i) => ({ ...i, group: entry.group })) : null;
}

// Настрій змінює спрайт, а не позицію: тіло, обличчя й руки мають власні
// версії, листя ще й провисає під власною вагою.
function moodBase(inst, mood, layout) {
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
    const out = { ...inst, group: `face_setA_${art}`, sprite: inst.sprite.replace("A_normal_", `A_${art}_`) };
    // Зіниця сумного набору стає на місце ока звичайного — інакше погляд
    // «з'їжджає» (у макеті вони різного розміру). Підміняємо ДО зростання:
    // раніше це робилось після, координатами дорослого макета, і на
    // маленькому кавенятку очі сумного й зів'ялого висіли не там, де решта
    // обличчя (власник, 28.09.2026).
    if (inst.sprite.includes("_pupil_")) {
      const side = inst.sprite.includes("_L") ? "L" : "R";
      const eye = layout.instances.find((i) => i.group === "face_setA_normal" && i.sprite.includes(`_eye_${side}`));
      if (eye) Object.assign(out, { x: eye.x, y: eye.y, scale: eye.scale });
    }
    return [out];
  }
  return [{ ...inst }];
}

// Базові шари під потрібну стадію: стовбур свого тіру, тіло, обличчя, руки.
export function baseInstances(layout, stage, mood, faceSet = 1) {
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

  const face = ownFace(layout, faceSet, mood);
  const place = (m) => {
    const grown = applyGrowth(m, ANCHOR, f);
    return bodyShiftY && /^(body_stage1|face_set)/.test(m.group) ? { ...grown, y: grown.y + bodyShiftY } : grown;
  };
  for (const inst of layout.instances) {
    if (!BASE_GROUPS.has(inst.group)) continue;
    if (inst.group === "branch_arms_fixed" && stage < 3) continue;
    if (face && inst.group === "face_setA_normal") continue;
    for (const m of moodBase(inst, mood, layout)) {
      if (m.group === "platform") { out.push({ ...m }); continue; }
      if (m.group === "trunk_tiers") {
        if (tierFile) out.push(applyGrowth({ ...m, sprite: tierFile }, ANCHOR, f));
        continue;
      }
      out.push(place(m));
    }
  }
  // Росте й зсувається на стадії 1 так само, як обличчя A на його місці.
  // Порядок шарів ока з однаковим z тримає стабільне сортування в buildScene.
  if (face) out.push(...face.map(place));
  return out;
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
  // front — «листя на чолі»: гілки й передні листки, які лягають поверх
  // уборів із foliage (навушники, пов'язка; wornInstances).
  if (stage >= 3) {
    for (const b of a.branches ?? []) {
      out.push(grow(b, { group: branchGroup(mood), sprite: branchSprite(b.skin, mood), z: 41, front: "branch" }));
    }
  }
  if (stage >= 2) {
    for (const l of a.leaves_fg ?? []) {
      out.push(grow(l, {
        group: leafGroup(mood), sprite: leafSprite(l.skin, mood),
        rotation: gravityDroop(l.rotation ?? 0, mood), z: 53, front: "leaf",
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

// Одяг — assets/clothes_layout.json (layout.clothes), його збирає
// design/sprites/pipeline/export_clothes_client.py з того, що власник
// припасував у clothes_sets_viewer.html. Кожен предмет там уже запечений у
// PNG (перспектива, поворот, розтяг під силует — у пікселях), тож тут лише
// перенос: шари лежать у координатах дорослого куща, і кожен кладемо
// ВІДНОСНО тіла — так річ сидить на будь-якій стадії (на стадії 1 тіло іншого
// розміру й ще й підняте на стовбурі). Настрій вибирає свій набір шарів:
// у сумному й зів'ялому голова осідає, і головний убір опускається з нею.
//
// Дві особливості, які не запекти в одну картинку, бо залежать від куща
// гравця, — маскові шари (Scene.jsx малює їх контейнером із CSS-маскою):
//   * reveal (сорочки): поверх сорочки — копія ДЕРЕВИНИ рук (branch_arms_wood,
//     без листя) у масці отвору й зовнішньої половини обідка манжета: гілка
//     виходить з отвору поверх обідка, а внутрішня половина обідка лягає
//     поверх неї — так видно, що вона росте з рукава. Руки під кожну сорочку ще й
//     повернуті навколо кореня (layer.arms, armPoses), щоб гілка йшла крізь
//     центр отвору — інакше на частині сорочок отвір лишався порожнім;
//   * foliage (навушники, пов'язка): копії гілок і передніх листків гравця
//     поверх убору в масці самого убору; гілки ще й без кулі-голови (маска
//     ball), бо вони за нею. Убір тоді над окулярами, але під листям на чолі.
const SLOT_RANK = { pants: 0, feet: 1, body: 2, head: 3, acc_1: 4 };

// Поворот рук-гілок під вдягнену сорочку: { L|R: { rot, pivot } } у сцені
// дорослого куща (null — сорочки з рукавами немає).
function shirtArms(clothes, worn, mood) {
  const art = ART_SUFFIX[mood] ?? "normal";
  for (const w of worn ?? []) {
    const item = clothes?.items?.[w.sprite_id];
    if (item?.slot !== "body") continue;
    const l = (item.moods?.[art] ?? item.moods?.normal ?? [])[0];
    if (l?.reveal) return l.arms ?? {};
  }
  return null;
}

// Руки базового куща, повернуті під сорочку. Корінь — у координатах дорослого
// куща, тож переносимо його від тіла так само, як шари одягу.
export function poseArms(base, layout, worn, body, mood = "healthy") {
  const clothes = layout?.clothes;
  const arms = shirtArms(clothes, worn, mood);
  if (!arms || !body || !clothes?.body) return base;
  const ref = clothes.body, k = body.scale / ref.scale;
  return base.map((i) => {
    if (!/^branch_arms_fixed/.test(i.group ?? "")) return i;
    const p = arms[/_L(_|\.)/.test(i.sprite) ? "L" : "R"];
    if (!p?.rot) return i;
    const px = body.x + (p.pivot[0] - ref.x) * k, py = body.y + (p.pivot[1] - ref.y) * k;
    const t = (p.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), dx = i.x - px, dy = i.y - py;
    return { ...i, x: px + dx * c - dy * s, y: py + dx * s + dy * c, rotation: (i.rotation ?? 0) + p.rot };
  });
}

export function wornInstances(layout, worn, body, mood = "healthy", base = [], player = []) {
  const clothes = layout?.clothes;
  if (!worn?.length || !body || !clothes?.items || !clothes.body) return [];
  const ref = clothes.body;
  const k = body.scale / ref.scale;
  const at = (l) => ({ ...l, x: body.x + (l.x - ref.x) * k, y: body.y + (l.y - ref.y) * k, scale: l.scale * k, rotation: 0 });
  const art = ART_SUFFIX[mood] ?? "normal";
  const sprite = ({ group, sprite: file, x, y, scale, z }) => ({ group, sprite: file, x, y, scale, z, rotation: 0 });

  const items = worn.map((w) => clothes.items[w.sprite_id]).filter(Boolean)
    .sort((a, b) => (SLOT_RANK[a.slot] ?? 9) - (SLOT_RANK[b.slot] ?? 9));

  // Штани в чоботах чи чоботи під холошами — вирішує взуття, а не штани
  // (власник, 03.10.2026). Пайплайн ставить z штанам і взуттю кожного набору
  // разом (sets[].feet у clothes_layout.json: у ковбоя й пірата over_pants —
  // халяви поверх холош, у решти навпаки). У змішаному комплекті штани брали
  // висоту зі свого набору: ковбойські джинси лягали під кеди, а штани
  // хіпстера — поверх ковбойських чобіт. Тепер штани стають на ту висоту,
  // яку їм відвів набір вдягненого взуття.
  const layersOf = (item) => item?.moods?.[art] ?? item?.moods?.normal ?? [];
  const feetId = worn.map((w) => w.sprite_id).find((id) => clothes.items[id]?.slot === "feet");
  const feetSet = feetId ? (clothes.sets ?? []).find((st) => st.codes?.feet === feetId) : null;
  const pantsOfFeet = feetId ? layersOf(clothes.items[feetSet?.codes?.pants ?? feetId.replace(/_feet$/, "_pants")])[0] : null;

  const out = [];
  for (const item of items) {
    const layers = layersOf(item);
    const shift = item.slot === "pants" && pantsOfFeet && layers[0] ? pantsOfFeet.z - layers[0].z : 0;
    for (const raw of layers) {
      const l = at(shift ? { ...raw, z: raw.z + shift } : raw);
      out.push(sprite(l));
      if (l.reveal) {
        // base — уже з руками, повернутими під цю сорочку (poseArms)
        const arms = base.filter((i) => (i.group || "").startsWith(l.reveal.under));
        if (arms.length) {
          out.push({
            z: l.z,
            masks: [sprite({ ...at({ ...raw, ...l.reveal }) })],
            children: arms.map((a) => (l.reveal.copy ? { ...a, group: l.reveal.copy } : { ...a })),
          });
        }
      }
      if (l.foliage) {
        const ball = clothes.ball?.[art] ?? clothes.ball?.normal;
        const leaves = player.filter((i) => i.front === "leaf");
        const branches = player.filter((i) => i.front === "branch");
        if (leaves.length) out.push({ z: l.z, masks: [sprite(l)], children: leaves.map((a) => ({ ...a })) });
        if (branches.length) {
          out.push({
            z: l.z,
            masks: [sprite(l), ...(ball ? [{ ...sprite(at(ball)), op: "subtract" }] : [])],
            children: branches.map((a) => ({ ...a })),
          });
        }
      }
    }
  }
  return out;
}

// Чернетка посадки на головному екрані: розставлене видно ще до «Посадити»
// (власник, 01.10.2026). items — уже розв'язані (placement.resolveDraft). На
// екрані посадки вони стоять на кущі цільової стадії, тож і тут спершу
// ростуть під неї, а потім переносяться від тіла тієї стадії до тіла
// поточної — як одяг у wornInstances. Інакше на стадії 1, де тіло підняте на
// тонкому стовбурі, листя висіло б нижче голови.
export function draftInstances(layout, items, { stage, to, mood = "healthy", budsBefore = 0 }) {
  if (!layout || !items) return [];
  const f = growthFactor(to);
  const out = playerInstances({ leaves_bg: items.bg, leaves_fg: items.fg, branches: items.branches }, to, mood);
  (items.buds ?? []).forEach((bud, n) => {
    const [group, sprite] = fruitSprite(to, budsBefore + n);
    out.push(applyGrowth({ ...bud, group, sprite, z: FRUIT_FOREGROUND_Z + budsBefore + n }, ANCHOR, f));
  });
  if (stage === to) return out;
  const bodyOf = (s) => baseInstances(layout, s, mood).find((i) => /^body_stage1/.test(i.group));
  const from = bodyOf(to), now = bodyOf(stage);
  if (!from || !now) return [];
  const k = now.scale / from.scale;
  return out.map((i) => ({ ...i, x: now.x + (i.x - from.x) * k, y: now.y + (i.y - from.y) * k, scale: i.scale * k }));
}

// Одяг видно на кавенятку будь-якої стадії, де вже є тіло: речі з
// примірочної — і на малому кущі (власник, 01.10.2026; 28.09 було «лише на
// дорослому»). Подаровані комплекти й так бувають лише в дорослих, а в
// паростка тіла ще немає, і wornInstances нічого не малює. Положення речей
// рахується від тіла, тож сидять вони на будь-якій стадії.
export function buildScene({ layout, appearance, stage, mood = "healthy", worn, extra = [], faceSet = 1 }) {
  if (!layout) return [];
  const unposed = baseInstances(layout, stage, mood, faceSet);
  const body = unposed.find((i) => /^body_stage1/.test(i.group));
  // руки повертаються під рукава вдягненої сорочки (без сорочки — як були)
  const base = poseArms(unposed, layout, worn, body, mood);
  const player = playerInstances(appearance, stage, mood);
  // Стабільне сортування: шари одягу з однаковим z лягають у порядку
  // wornInstances — маска рукавів після сорочки, задня частина парасольки
  // (z сорочки) після них.
  return [...base, ...player, ...wornInstances(layout, worn, body, mood, base, player), ...extra]
    .sort((a, b) => a.z - b.z);
}
