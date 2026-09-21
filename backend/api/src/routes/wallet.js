// Гаманець: переказ монет іншому гравцю, купівля пачок монет і редім
// бонусу за чек.
//
// Три різні дії, які поєднує одне: кожна рухає баланс, тому кожна пише
// рядок у журнал у тій самій транзакції, що й зміну колонки.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { notifyPlant } from "../notify.js";

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";

// У бонусі лежать коди предметів; плитці потрібні назва, комплект,
// рідкість і спрайт — «Капелюх / «Ковбой»» у рамці кольору тіру.
async function itemsOf(list) {
  const codes = Array.isArray(list) ? list : [];
  if (!codes.length) return [];
  const defs = await many("select code, name, collection, tier, sprite_id from item_defs where code = any($1)", [codes]);
  return codes.map((code) => defs.find((d) => d.code === code)).filter(Boolean);
}

export default async function routes(app) {
  // ── переказ монет ──────────────────────────────────────────────────
  // Тільки жовті: срібні за визначенням не переказуються (economy §2.1),
  // і в таблиці coin_transfers немає колонки валюти саме тому.
  app.get("/me/transfer/check", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.query?.nickname ?? "").trim();
    if (!nickname) fail(400, "nickname_required");
    const target = await one("select id, nickname from users where nickname = $1 and deleted_at is null", [nickname]);
    if (!target) return { found: false };
    return { found: true, nickname: target.nickname, self: target.id === user.id };
  });

  app.post("/me/transfer", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const nickname = String(req.body?.nickname ?? "").trim();
    const amount = Math.trunc(Number(req.body?.amount ?? 0));
    if (!nickname) fail(400, "nickname_required");
    if (!(amount > 0)) fail(400, "bad_amount");

    return tx(async (client) => {
      // Нікнейм відправника потрібен для журналу отримувача, а в токені
      // його немає — беремо з бази разом з усім іншим.
      const { rows: me } = await client.query("select nickname from users where id = $1", [user.id]);
      const { rows: targets } = await client.query(
        "select id, nickname from users where nickname = $1 and deleted_at is null", [nickname]);
      const target = targets[0];
      if (!target) fail(404, "no_such_user");
      if (target.id === user.id) fail(409, "self_transfer");

      const { rows: paid } = await client.query(
        "update users set coins_yellow = coins_yellow - $2 where id = $1 and coins_yellow >= $2 returning coins_yellow",
        [user.id, amount]
      );
      if (!paid.length) fail(409, "not_enough", { need: amount });
      await client.query("update users set coins_yellow = coins_yellow + $2 where id = $1", [target.id, amount]);

      const { rows: transfer } = await client.query(
        "insert into coin_transfers (from_user, to_user, amount) values ($1, $2, $3) returning id",
        [user.id, target.id, amount]
      );
      const meta = { transfer_id: transfer[0].id, to: target.nickname };
      await client.query(
        `insert into ledger_entries (user_id, delta_yellow, reason, ref_type, ref_id, meta)
         values ($1, $2, 'transfer', 'coin_transfer', $3, $4)`,
        [user.id, -amount, transfer[0].id, meta]
      );
      await client.query(
        `insert into ledger_entries (user_id, delta_yellow, reason, ref_type, ref_id, meta)
         values ($1, $2, 'transfer', 'coin_transfer', $3, $4)`,
        [target.id, amount, transfer[0].id, { transfer_id: transfer[0].id, from: me[0].nickname }]
      );
      await notifyPlant(target.id, `Тобі переказали ${amount} жовтих монет.`, { client });

      return { ok: true, amount, to: target.nickname, left: paid[0].coins_yellow };
    });
  });

  // ── редім бонусу за чек ────────────────────────────────────────────
  // Бонус живе на чеку, а не на гравці: підібрати чужий не можна, бо
  // claim_token друкується на екрані кіоска саме для цієї покупки.
  // Прев'ю бонусу ДО входу: стартовий екран показує «Увійди, щоб не
  // втратити бонуси» з реальною сумою (кадр «Стартовий екран»). Токен сам по
  // собі і є секретом — він світиться лише на екрані кіоска, — тож суму
  // тому, хто його має, показати можна; хто забрав і коли — ні.
  app.get("/bonus/:token/preview", async (req) => {
    const grant = await one(
      `select coins_yellow, items, status, expires_at from bonus_grants where claim_token = $1`,
      [String(req.params.token)]
    );
    if (!grant) fail(404, "no_such_bonus");
    return {
      coins: grant.coins_yellow,
      items: await itemsOf(grant.items),
      available: grant.status === "pending" && new Date(grant.expires_at) > new Date(),
    };
  });

  app.get("/me/bonus/:token", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const grant = await one(
      `select bg.*, r.fiscal_date, r.total_sum, p.name as point_name
         from bonus_grants bg
         join receipts r on r.id = bg.receipt_id
         join points p on p.id = bg.point_id
        where bg.claim_token = $1`,
      [String(req.params.token)]
    );
    if (!grant) fail(404, "no_such_bonus");
    return {
      coins: grant.coins_yellow,
      items: await itemsOf(grant.items),
      point: grant.point_name,
      fiscal_date: grant.fiscal_date,
      total_uah: grant.total_sum,
      status: grant.status,
      expired: new Date(grant.expires_at) < new Date(),
      mine: grant.redeemed_by === user.id,
    };
  });

  app.post("/me/bonus/:token", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    return tx(async (client) => {
      const { rows } = await client.query(
        "select * from bonus_grants where claim_token = $1 for update",
        [String(req.params.token)]
      );
      const grant = rows[0];
      if (!grant) fail(404, "no_such_bonus");
      if (grant.redeemed_by) fail(409, grant.redeemed_by === user.id ? "already_yours" : "already_taken");
      if (new Date(grant.expires_at) < new Date()) fail(409, "expired");

      await client.query(
        "update bonus_grants set redeemed_by = $2, redeemed_at = now(), status = 'redeemed' where id = $1",
        [grant.id, user.id]
      );
      await client.query("update users set coins_yellow = coins_yellow + $2 where id = $1", [user.id, grant.coins_yellow]);
      await client.query(
        `insert into ledger_entries (user_id, delta_yellow, reason, ref_type, ref_id, meta)
         values ($1, $2, 'purchase', 'receipt', $3, $4)`,
        [user.id, grant.coins_yellow, grant.receipt_id, { bonus_grant_id: grant.id }]
      );

      // Лутдроп із чека, якщо випав: предмети лежать у самому бонусі.
      const items = Array.isArray(grant.items) ? grant.items : [];
      for (const code of items) {
        const { rows: defs } = await client.query("select id from item_defs where code = $1", [code]);
        if (!defs.length) continue;
        await client.query(
          "insert into user_items (user_id, item_def_id, acquired_from) values ($1, $2, 'bonus_drink')",
          [user.id, defs[0].id]
        );
      }

      return { ok: true, coins: grant.coins_yellow, items };
    });
  });
}
