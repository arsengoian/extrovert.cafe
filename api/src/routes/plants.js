// Кавенятка гравця. Настрій НЕ зберігається — він рахується з
// last_watered_at (bush_graphics_customization.md §4), тому рахуємо тут, а
// не в клієнті: інакше двоє клієнтів покажуть різне.
import { many, one } from "../db.js";
import { requireUser } from "../auth.js";
import { growthState } from "./planting.js";

const DAYS = 24 * 60 * 60 * 1000;
const SAD_AFTER_DAYS = 3;
const WITHERED_AFTER_DAYS = 7;

export function moodOf(plant) {
  // На продажу кущ заморожений: настрій не показуємо взагалі
  // (gamification_ui.md, полив під час лістингу).
  if (plant.listing_id) return "healthy";
  if (!plant.last_watered_at) return "healthy";
  const days = (Date.now() - new Date(plant.last_watered_at).getTime()) / DAYS;
  if (days >= WITHERED_AFTER_DAYS) return "withered";
  if (days >= SAD_AFTER_DAYS) return "sad";
  return "healthy";
}

// Гейт росту: один перехід на добу (db-schema, plants.last_stage_transition_at).
export function canGrow(plant) {
  if (!plant.last_stage_transition_at) return true;
  return Date.now() - new Date(plant.last_stage_transition_at).getTime() >= DAYS;
}

const view = (p) => ({
  id: p.id,
  name: p.name,
  growth_stage: p.growth_stage,
  face_set_id: p.face_set_id,
  cycle_phase: p.cycle_phase,
  appearance: p.appearance,
  mood: moodOf(p),
  can_grow: canGrow(p),
  growth: growthState(p),
  draft: p.appearance?.draft ? { kind: p.appearance.draft.kind, count: p.appearance.draft.count ?? null } : null,
  on_sale: Boolean(p.listing_id),
  worn_set_id: p.worn_set_id,
  last_watered_at: p.last_watered_at,
  lifetime_beans_gifted: p.lifetime_beans_gifted,
  created_at: p.created_at,
});

export default async function routes(app) {
  app.get("/me/plants", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      "select * from plants where owner_id = $1 order by created_at",
      [user.id]
    );
    return { plants: rows.map(view) };
  });

  app.get("/me/plants/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one("select * from plants where id = $1 and owner_id = $2", [
      req.params.id,
      user.id,
    ]);
    if (!row) return reply.code(404).send({ error: "no_such_plant" });

    // Вдягнений комплект: слоти з предметами, які зараз на кущі.
    const worn = row.worn_set_id
      ? await many(
          `select wsi.slot, d.code, d.name, d.sprite_id, d.tier
             from wardrobe_set_items wsi
             join user_items ui on ui.id = wsi.user_item_id
             join item_defs d on d.id = ui.item_def_id
            where wsi.set_id = $1`,
          [row.worn_set_id]
        )
      : [];

    return { plant: view(row), worn };
  });
}
