// Кавенятка гравця. Настрій НЕ зберігається — він рахується з
// last_watered_at (bush_graphics_customization.md §4), тому рахуємо тут, а
// не в клієнті: інакше двоє клієнтів покажуть різне.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { notifyPlant } from "../notify.js";
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
  // Ціна лота — для плашки «На продажу · 1 800» на головному екрані.
  listing: p.listing_price ? { id: p.listing_id, price: p.listing_price, currency: p.listing_currency } : null,
  // Скільки реплік кавенятка й системи гравець ще не бачив у чаті.
  chat_unread: p.chat_unread ?? 0,
  worn_set_id: p.worn_set_id,
  last_watered_at: p.last_watered_at,
  lifetime_beans_gifted: p.lifetime_beans_gifted,
  created_at: p.created_at,
});

// Одяг кавенятка при зміні власника чи скошуванні (gamification_ui.md,
// меню дій): подаровані комплекти замкнені назавжди й живуть із кущем,
// а примірочна — просто речі гравця, які повертаються на його склад.
async function releaseFittingRoom(client, plantId) {
  await client.query(
    `update user_items set set_id = null
      where set_id in (select id from wardrobe_sets where plant_id = $1 and not gifted)`, [plantId]);
  await client.query("delete from wardrobe_sets where plant_id = $1 and not gifted", [plantId]);
}

async function lockOwnPlant(client, id, userId) {
  const { rows } = await client.query("select * from plants where id = $1 and owner_id = $2 for update", [id, userId]);
  const plant = rows[0];
  if (!plant) fail(404, "no_such_plant");
  if (plant.listing_id) fail(409, "on_sale");
  return plant;
}

export default async function routes(app) {
  // «Подарувати другу»: кавенятко переходить іншому гравцю разом з усіма
  // подарованими комплектами, скасувати не можна. Останнє кавенятко не
  // віддаємо — як і при продажу, гравець не лишається без куща.
  app.post("/me/plants/:id/gift", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.body?.nickname ?? "").trim();
    if (!nickname) fail(400, "nickname_required");

    return tx(async (client) => {
      const plant = await lockOwnPlant(client, req.params.id, user.id);
      const { rows: targets } = await client.query(
        "select id, nickname from users where nickname = $1 and deleted_at is null", [nickname]);
      const target = targets[0];
      if (!target) fail(404, "no_such_user");
      if (target.id === user.id) fail(409, "self_gift");
      const { rows: count } = await client.query("select count(*)::int as n from plants where owner_id = $1", [user.id]);
      if (count[0].n <= 1) fail(409, "last_plant");

      await releaseFittingRoom(client, plant.id);
      await client.query(
        `update user_items set user_id = $2
          where id in (select wsi.user_item_id from wardrobe_set_items wsi
                         join wardrobe_sets ws on ws.id = wsi.set_id where ws.plant_id = $1)`,
        [plant.id, target.id]
      );
      // Розмови лишаються тому, хто їх вів: новому власнику — чистий чат.
      await client.query("delete from chat_messages where plant_id = $1", [plant.id]);
      await client.query("update plants set owner_id = $2, chat_seen_at = null where id = $1", [plant.id, target.id]);
      const { rows: me } = await client.query("select nickname from users where id = $1", [user.id]);
      await notifyPlant(target.id, `${me[0].nickname} подарував тобі кавенятко «${plant.name || "без імені"}».`, { client });
      return { ok: true, to: target.nickname };
    });
  });

  // «Скосити»: кущ зникає разом із ресурсами й подарованими комплектами, а
  // гравець отримує лише свіжий саджанець — щоб виростити нове кавенятко.
  app.post("/me/plants/:id/scythe", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return tx(async (client) => {
      const plant = await lockOwnPlant(client, req.params.id, user.id);
      await releaseFittingRoom(client, plant.id);
      const { rows: gifted } = await client.query(
        `select wsi.user_item_id as id from wardrobe_set_items wsi
           join wardrobe_sets ws on ws.id = wsi.set_id where ws.plant_id = $1`, [plant.id]);
      await client.query("delete from wardrobe_sets where plant_id = $1", [plant.id]);
      if (gifted.length) await client.query("delete from user_items where id = any($1)", [gifted.map((g) => g.id)]);
      await client.query("delete from plants where id = $1", [plant.id]);
      const { rows } = await client.query(
        "insert into plants (owner_id, face_set_id) values ($1, $2) returning id",
        [user.id, 1 + Math.floor(Math.random() * 3)]
      );
      return { ok: true, plant_id: rows[0].id };
    });
  });

  // Імʼя кавенятка: бачить його лише власник, тому обмеження мʼякі —
  // тільки довжина й заборона порожнього рядка з пробілів.
  app.patch("/me/plants/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const name = String(req.body?.name ?? "").trim().slice(0, 24);
    if (!name) return reply.code(400).send({ error: "empty_name" });
    const row = await one(
      "update plants set name = $3 where id = $1 and owner_id = $2 returning id, name",
      [req.params.id, user.id, name]
    );
    if (!row) return reply.code(404).send({ error: "no_such_plant" });
    return { ok: true, name: row.name };
  });

  app.get("/me/plants", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      `select p.*, l.price_amount as listing_price, l.price_currency as listing_currency,
              (select count(*)::int from chat_messages m
                where m.plant_id = p.id and m.role <> 'user'
                  and (p.chat_seen_at is null or m.created_at > p.chat_seen_at)) as chat_unread,
              -- вдягнений комплект: головний екран малює його на кущі одразу
              coalesce((select json_agg(json_build_object('slot', wsi.slot, 'code', d.code, 'name', d.name,
                                                          'sprite_id', d.sprite_id, 'tier', d.tier))
                          from wardrobe_set_items wsi
                          join user_items ui on ui.id = wsi.user_item_id
                          join item_defs d on d.id = ui.item_def_id
                         where wsi.set_id = p.worn_set_id), '[]') as worn
         from plants p
         left join market_listings l on l.id = p.listing_id and l.status = 'active'
        where p.owner_id = $1 order by p.created_at`,
      [user.id]
    );
    return { plants: rows.map((r) => ({ ...view(r), worn: r.worn })) };
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
