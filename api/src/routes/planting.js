// Ріст кавенятка: догляд (полив, компост, добриво, інсектицид) і посадка
// листя, гілок та бутонів.
//
// Дві різні дії, які легко сплутати:
//   • догляд — списує препарат і рухає стадію (economy §3.2);
//   • посадка — розставляє спрайти й фіксується разом із тим самим
//     списанням, бо переходи 1→2, 2→3 і 3→4…6→7 без неї не мають сенсу.
//
// Поки гравець не натиснув «Посадити», нічого не списано: чернетка лежить
// у appearance.draft і переживає вихід із застосунку (docs/bush_planting_ui.md §1).
//
// Геометрію сервер НЕ перевіряє — свідоме рішення §9 того ж доку. Тут
// перевіряються лише кількості й препарат: це дешево й ловить не злам, а
// власний баг клієнта.
import { one, query, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";

const DAY = 24 * 60 * 60 * 1000;

const CARE_COLUMN = {
  water: "water_liters",
  compost: "compost_kg",
  fertilizer: "fertilizer_kg",
  insecticide: "insecticide_bottles",
};

// Що садиться на переході в цю стадію і скільки штук за раз.
const PLANTING = {
  2: { kind: "leaves", limits: { bg: [20, 40], fg: [0, 5] } },
  3: { kind: "branches", limits: { branches: [2, 4] } },
  4: { kind: "buds", limits: { buds: [1, 1] } },
  5: { kind: "buds", limits: { buds: [2, 2] } },
  6: { kind: "buds", limits: { buds: [2, 2] } },
  7: { kind: "buds", limits: { buds: [2, 2] } },
};

const transitionFrom = (stage) => economy.growth_transitions.find((t) => t.from === stage) ?? null;

// Коли перехід приймає два різні препарати, вибір має бути стабільним:
// інакше кавенятко «передумувало б» на кожен запит, а гравець купив би не
// те. Тому не Math.random, а хеш від id рослини й стадії.
function pickNeed(transition, plantId) {
  const options = transition.need.split("|");
  if (options.length === 1) return options[0];
  let h = 0;
  for (const ch of `${plantId}:${transition.from}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

export function growthState(plant) {
  const transition = transitionFrom(plant.growth_stage);
  if (!transition) return { done: true };
  const need = pickNeed(transition, plant.id);
  const applications = transition.applications ?? 1;
  const planting = PLANTING[transition.to] ?? null;
  const waitUntil = plant.last_stage_transition_at
    ? new Date(new Date(plant.last_stage_transition_at).getTime() + DAY)
    : null;

  return {
    done: false,
    from: transition.from,
    to: transition.to,
    need,
    applications,
    progress: plant.stage_progress ?? 0,
    planting: planting?.kind ?? null,
    limits: planting?.limits ?? null,
    // Одна стадія на добу — гейт живе в базі (last_stage_transition_at).
    ready_at: waitUntil && waitUntil > new Date() ? waitUntil : null,
  };
}

async function loadPlant(client, id, userId) {
  const { rows } = await client.query("select * from plants where id = $1 and owner_id = $2 for update", [id, userId]);
  return rows[0] ?? null;
}

// Один спільний шлях для «зросли на стадію»: і догляд, і посадка приходять
// сюди, тому запис у журнал переходів не може загубитись в одній із гілок.
async function advance(client, plant, state, { consumed, appearance }) {
  await client.query(
    `update plants
      set growth_stage = $2, stage_progress = 0, last_stage_transition_at = now(),
        appearance = $3
      where id = $1`,
    [plant.id, state.to, appearance ?? plant.appearance]
  );
  await client.query(
    `insert into plant_stage_transitions (plant_id, from_stage, to_stage, consumed, cost_coins)
     values ($1, $2, $3, $4, $5)`,
    [plant.id, state.from, state.to, consumed, 0]
  );
}

export default async function routes(app) {
  // Догляд: один препарат за раз. Якщо перехід вимагає ще й посадки —
  // нічого не списуємо й кажемо клієнту, який екран відкрити.
  app.post("/me/plants/:id/care", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const kind = String(req.body?.kind ?? "");
    if (!CARE_COLUMN[kind]) fail(400, "bad_care");

    return tx(async (client) => {
      const plant = await loadPlant(client, req.params.id, user.id);
      if (!plant) fail(404, "no_such_plant");
      if (plant.listing_id) fail(409, "on_sale");

      // Полив — єдина дія, доступна завжди: сумний кущ п'є і поза переходом.
      const state = growthState(plant);
      const watering = kind === "water";
      if (!watering) {
        if (state.done) fail(409, "fully_grown");
        if (kind !== state.need) fail(409, "wrong_care", { need: state.need });
        if (state.ready_at) fail(409, "too_soon", { ready_at: state.ready_at });
        if (state.planting) fail(409, "needs_planting", { planting: state.planting });
      }

      const column = CARE_COLUMN[kind];
      const { rows: spent } = await client.query(
        `update users set ${column} = ${column} - 1 where id = $1 and ${column} > 0 returning ${column} as left`,
        [user.id]
      );
      if (!spent.length) fail(409, "no_supply", { kind });

      if (watering) await client.query("update plants set last_watered_at = now() where id = $1", [plant.id]);

      // Полив поза переходом (кущ просто хоче пити) стадію не рухає.
      const counts = !state.done && kind === state.need && !state.ready_at;
      if (!counts) return { ok: true, grown: false, left: spent[0].left };

      const progress = (plant.stage_progress ?? 0) + 1;
      if (progress < state.applications) {
        await client.query("update plants set stage_progress = $2 where id = $1", [plant.id, progress]);
        return { ok: true, grown: false, progress, applications: state.applications, left: spent[0].left };
      }

      await advance(client, plant, state, { consumed: kind });
      return { ok: true, grown: true, stage: state.to, left: spent[0].left };
    });
  });

  // Стан екрана посадки: що садимо, скільки лишилось, що в чернетці.
  app.get("/me/plants/:id/planting", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const plant = await one("select * from plants where id = $1 and owner_id = $2", [req.params.id, user.id]);
    if (!plant) fail(404, "no_such_plant");

    const state = growthState(plant);
    const supply = await one("select water_liters, compost_kg, fertilizer_kg, insecticide_bottles from users where id = $1", [user.id]);
    return {
      state,
      draft: plant.appearance?.draft ?? null,
      appearance: plant.appearance ?? {},
      supply,
    };
  });

  // Чернетка: зберігається як є, без списань і без перевірок кількості —
  // її сенс саме в тому, щоб можна було кинути посадку на півдорозі.
  app.put("/me/plants/:id/planting/draft", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const draft = req.body?.draft ?? null;
    const { rows } = await query(
      `update plants
          set appearance = case when $3::jsonb is null
                                then appearance - 'draft'
                                else jsonb_set(appearance, '{draft}', $3::jsonb, true) end
        where id = $1 and owner_id = $2
        returning appearance -> 'draft' as draft`,
      [req.params.id, user.id, draft ? JSON.stringify(draft) : null]
    );
    if (!rows.length) fail(404, "no_such_plant");
    return { ok: true, draft: rows[0].draft };
  });

  // Підтвердження: списати препарат, зафіксувати посаджене, зрости.
  app.post("/me/plants/:id/planting", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const items = req.body?.items ?? {};

    return tx(async (client) => {
      const plant = await loadPlant(client, req.params.id, user.id);
      if (!plant) fail(404, "no_such_plant");
      if (plant.listing_id) fail(409, "on_sale");

      const state = growthState(plant);
      if (state.done || !state.planting) fail(409, "nothing_to_plant");
      if (state.ready_at) fail(409, "too_soon", { ready_at: state.ready_at });

      // Кількості — єдине, що перевіряємо: геометрію рахує клієнт (§9).
      for (const [key, [min, max]] of Object.entries(state.limits)) {
        const n = (items[key] ?? []).length;
        if (n < min || n > max) fail(400, "bad_count", { key, min, max, got: n });
      }

      const column = CARE_COLUMN[state.need];
      const { rows: spent } = await client.query(
        `update users set ${column} = ${column} - 1 where id = $1 and ${column} > 0 returning ${column} as left`,
        [user.id]
      );
      if (!spent.length) fail(409, "no_supply", { kind: state.need });

      // Посаджене дописується до наявного: гілки додаються до гілок,
      // бутони — до бутонів, і нічого з минулих стадій не зникає.
      const appearance = { ...(plant.appearance ?? {}) };
      delete appearance.draft;
      appearance.version = 2;
      const append = (key, list) => {
        if (!list?.length) return;
        const before = appearance[key] ?? [];
        const base = before.reduce((m, it) => Math.max(m, it.id ?? 0), 0);
        appearance[key] = [...before, ...list.map((it, n) => ({ ...it, id: base + n + 1 }))];
      };
      append("leaves_bg", items.bg);
      append("leaves_fg", items.fg);
      append("branches", items.branches);
      append("buds", items.buds);

      await advance(client, plant, state, { consumed: state.need, appearance });
      return { ok: true, stage: state.to, left: spent[0].left };
    });
  });
}
