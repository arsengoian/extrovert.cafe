// Профіль гравця: усе, що показує HUD і вкладки «Гаманець», «Склад»,
// «Покупки». Баланси й інвентар догляду — колонки users (db-schema §1).
import { many, one, query } from "../db.js";
import { requireUser } from "../auth.js";
import { generateNickname } from "../nickname.js";
import { TERMS_VERSION } from "./legal.js";

// Змінювати нікнейм з профілю — раз на 30 днів (попап «Змінити нікнейм»).
const NICKNAME_COOLDOWN_MS = 30 * 864e5;
const nicknameAvailableAt = (row) =>
  row.nickname_changed_at ? new Date(new Date(row.nickname_changed_at).getTime() + NICKNAME_COOLDOWN_MS) : null;

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
  // Без згоди з умовами застосунок показує лише екран «Твій нікнейм».
  consent: Boolean(row.consent_at),
  nickname_change_at: nicknameAvailableAt(row),
  created_at: row.created_at,
});

export default async function routes(app) {
  app.get("/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one("select * from users where id = $1", [user.id]);
    if (!row) return reply.code(404).send({ error: "no_such_user" });
    // Токен живе 15 хвилин, тож після видалення акаунта він ще якийсь час
    // валідний. Сесію ми гасимо, але цей рядок — те, що бачить клієнт
    // першим, і саме звідси він має дізнатись, що заходити більше нікуди.
    if (row.deleted_at) return reply.code(410).send({ error: "account_deleted" });

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
      // Позиція з id і позначкою опитування: картка напою в «Покупках» веде в
      // опитування саме про неї або показує «Опитування пройдено» (кадр
      // «Покупки кави»). Спрайт — з каталога, у чеку його немає.
      `select r.id, r.fiscal_date, r.total_sum, r.tax_url, p.name as point_name,
              bg.coins_yellow as bonus_coins, bg.status as bonus_status, bg.items as bonus_items,
              coalesce(json_agg(json_build_object(
                  'id', ri.id, 'name', ri.name, 'qty', ri.qty, 'sum', ri.sum_uah,
                  'system_code', ri.system_code, 'is_bonus', ri.is_bonus_drink,
                  'sprite', d.sprite, 'answered', q.id is not null
              ) order by ri.id) filter (where ri.id is not null), '[]') as items
         from receipts r
         join points p on p.id = r.point_id
         join bonus_grants bg on bg.receipt_id = r.id and bg.redeemed_by = $1
         left join receipt_items ri on ri.receipt_id = r.id
         left join drinks d on d.system_code = ri.system_code
         left join quiz_drink_responses q on q.receipt_item_id = ri.id
        group by r.id, p.name, bg.coins_yellow, bg.status, bg.items
        order by r.fiscal_date desc
        limit 50`,
      [user.id]
    );

    // Лутдроп бонусного напою лежить у бонусі кодами — картці потрібні
    // назва, рідкість і спрайт для плитки поруч із монетами.
    const codes = [...new Set(rows.flatMap((r) => (Array.isArray(r.bonus_items) ? r.bonus_items : [])))];
    const defs = codes.length
      ? await many("select code, name, collection, tier, sprite_id from item_defs where code = any($1)", [codes])
      : [];
    const def = Object.fromEntries(defs.map((d) => [d.code, d]));
    const receipts = rows.map(({ bonus_items: items, ...r }) => ({
      ...r,
      bonus_items: (Array.isArray(items) ? items : []).map((code) => def[code]).filter(Boolean),
    }));
    // Скільки напоїв усього й монет за них — для заголовка «34 напої · 780».
    const totals = await one(
      `select (select count(*)::int from receipt_items ri
                 join bonus_grants bg on bg.receipt_id = ri.receipt_id
                where bg.redeemed_by = $1) as drinks,
              (select coalesce(sum(coins_yellow), 0)::int from bonus_grants where redeemed_by = $1) as coins`,
      [user.id]
    );
    return { receipts, totals };
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

  // «вільний» під полем нікнейма — до того, як гравець натисне «Почати».
  app.get("/me/nickname/check", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.query?.nickname ?? "").trim();
    if (!NICKNAME_RE.test(nickname)) return { valid: false, free: false };
    const taken = await one("select 1 from users where nickname = $1 and id <> $2", [nickname, user.id]);
    return { valid: true, free: !taken };
  });

  // Перший вхід: гравець лишає чи міняє згенерований нікнейм і приймає
  // умови й політику приватності — одна дія, як на екрані.
  app.post("/me/consent", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.body?.nickname ?? "").trim();
    if (!NICKNAME_RE.test(nickname)) return reply.code(400).send({ error: "bad_nickname" });
    const taken = await one("select 1 from users where nickname = $1 and id <> $2", [nickname, user.id]);
    if (taken) return reply.code(409).send({ error: "nickname_taken" });

    await query(
      "update users set nickname = $2, consent_at = coalesce(consent_at, now()), terms_version = $3 where id = $1",
      [user.id, nickname, TERMS_VERSION]
    );
    return { ok: true, nickname };
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

    const row = await one("select nickname, nickname_changed_at from users where id = $1", [user.id]);
    if (row.nickname === nickname) return { nickname };
    const next = nicknameAvailableAt(row);
    if (next && next > new Date()) return reply.code(409).send({ error: "too_soon", next });

    await query("update users set nickname = $2, nickname_changed_at = now() where id = $1", [user.id, nickname]);
    return { nickname };
  });
}
