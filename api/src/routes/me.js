// Профіль гравця: усе, що показує HUD і вкладки «Гаманець», «Склад»,
// «Покупки». Баланси й інвентар догляду — колонки users (db-schema §1).
import { many, one, query } from "../db.js";
import { requireUser } from "../auth.js";
import { generateNickname } from "../nickname.js";

// Нікнейм видно іншим гравцям на маркеті, тож формат тримаємо вузьким:
// букви (будь-якої мови), цифри, підкреслення й дефіс.
const NICKNAME_RE = /^[\p{L}\p{N}_-]{3,24}$/u;

const profile = (row) => ({
  id: row.id,
  nickname: row.nickname,
  balances: { yellow: row.coins_yellow, silver: row.coins_silver, beans: row.beans },
  care: {
    water_liters: row.water_liters,
    compost_kg: row.compost_kg,
    fertilizer_kg: row.fertilizer_kg,
    insecticide_bottles: row.insecticide_bottles,
  },
  created_at: row.created_at,
});

export default async function routes(app) {
  app.get("/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one("select * from users where id = $1", [user.id]);
    if (!row) return reply.code(404).send({ error: "no_such_user" });

    // Лічильник на вкладці «Магазин»: замовлення зі зміною статусу, якої
    // гравець ще не відкривав (db-schema §2, user_seen_at).
    const unseen = await one(
      `select count(*)::int as n from redemptions
        where user_id = $1 and (user_seen_at is null or user_seen_at < status_changed_at)`,
      [user.id]
    );

    // Провайдер входу показується в профілі: «Google · пошта».
    const identity = await one(
      "select provider from user_identities where user_id = $1 order by created_at limit 1",
      [user.id]
    );

    return {
      ...profile(row),
      identity: { provider: identity?.provider ?? "dev", email: row.email },
      badges: { orders: unseen.n },
    };
  });

  // Склад: інвентар одягу з лічильником дублів (gamification_ui.md, Склад).
  app.get("/me/items", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      `select d.code, d.name, d.collection, d.slot, d.tier, d.sprite_id, d.description_md,
              count(*)::int as owned,
              count(*) filter (where ui.listing_id is not null)::int as listed,
              -- «вільна» копія — та, яку можна продати чи вдягнути: не
              -- замкнена комплектом, не на маркеті й не в чужому наборі
              count(*) filter (where not ui.locked and ui.listing_id is null and ui.set_id is null)::int as free,
              min(ui.id) filter (where not ui.locked and ui.listing_id is null and ui.set_id is null) as user_item_id
         from user_items ui
         join item_defs d on d.id = ui.item_def_id
        where ui.user_id = $1
        group by d.code, d.name, d.collection, d.slot, d.tier, d.sprite_id, d.description_md
        order by d.collection, d.slot`,
      [user.id]
    );
    return { items: rows };
  });

  // Покупки: чеки з ПРРО, зведені з бонусами за них.
  app.get("/me/history", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      `select r.id, r.fiscal_date, r.total_sum, r.tax_url, p.name as point_name,
              bg.coins_yellow as bonus_coins, bg.status as bonus_status,
              coalesce(json_agg(json_build_object(
                  'name', ri.name, 'qty', ri.qty, 'sum', ri.sum_uah,
                  'system_code', ri.system_code, 'is_bonus', ri.is_bonus_drink
              ) order by ri.id) filter (where ri.id is not null), '[]') as items
         from receipts r
         join points p on p.id = r.point_id
         join bonus_grants bg on bg.receipt_id = r.id and bg.redeemed_by = $1
         left join receipt_items ri on ri.receipt_id = r.id
        group by r.id, p.name, bg.coins_yellow, bg.status
        order by r.fiscal_date desc
        limit 50`,
      [user.id]
    );
    return { receipts: rows };
  });

  // Журнал операцій — «історія транзакцій» у Гаманці.
  app.get("/me/ledger", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      `select id, delta_yellow, delta_silver, delta_beans, reason, meta, created_at
         from ledger_entries where user_id = $1
        order by created_at desc limit 50`,
      [user.id]
    );
    return { entries: rows };
  });
}

export async function nicknameRoutes(app) {
  // Підказка для екрана зміни нікнейма: та сама генерація, що й при
  // реєстрації, тож гравець бачить звичний формат.
  app.get("/me/nickname/suggest", async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return { nickname: await generateNickname() };
  });

  app.patch("/me/nickname", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.body?.nickname ?? "").trim();

    if (!NICKNAME_RE.test(nickname)) {
      return reply.code(400).send({ error: "bad_nickname" });
    }
    const taken = await one("select 1 from users where nickname = $1 and id <> $2", [nickname, user.id]);
    if (taken) return reply.code(409).send({ error: "nickname_taken" });

    await query("update users set nickname = $2 where id = $1", [user.id, nickname]);
    return { nickname };
  });
}
