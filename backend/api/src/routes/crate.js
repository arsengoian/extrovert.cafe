// Відкриття скриньки. Правила — economy §4 і §4.2, і вони тут навмисно
// зібрані в одному місці: рол тіру, предмет, монети, журнал.
//
// Крейт ЗАВЖДИ дає і предмет, і монети. Дубль — нормальний результат:
// він лягає на склад і продається на P2P (§4.2).
//
// Купівля й відкриття — окремі кроки: куплена скринька (за монети тут або
// за гривні в payments.js) лягає на склад, у user_crates, а відкривається
// лише звідти — кадр «Склад» із карткою «Щасливі скриньки · Відкрити».
import { requireUser } from "../auth.js";
import { tx } from "../db.js";
import { economy, rollCrateCoins, rollTier } from "../economy.js";

const coded = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

// Рол і видача: предмет на склад, монети в гаманець, запис відкриття й
// журнал. paid — чим заплатили за цю скриньку при купівлі.
async function openCrate(client, userId, { source, paid }) {
  const tier = rollTier();
  const { rows: defs } = await client.query(
    `select id, code, name, collection, slot, tier, sprite_id, description_md
       from item_defs where active and tier = $1 order by random() limit 1`,
    [tier]
  );
  if (!defs.length) throw coded("no_items_for_tier");
  const def = defs[0];

  const dup = await client.query(
    "select 1 from user_items where user_id = $1 and item_def_id = $2 limit 1",
    [userId, def.id]
  );
  const wasDuplicate = dup.rowCount > 0;

  const { rows: items } = await client.query(
    `insert into user_items (user_id, item_def_id, acquired_from)
     values ($1, $2, 'crate') returning id`,
    [userId, def.id]
  );

  const coins = rollCrateCoins();
  const { rows: balance } = await client.query(
    "update users set coins_yellow = coins_yellow + $2 where id = $1 returning coins_yellow",
    [userId, coins]
  );

  const { rows: opening } = await client.query(
    `insert into crate_openings (user_id, source, paid_currency, paid_amount,
                                 result_item_id, result_coins, was_duplicate, rolled_tier)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [userId, source, paid?.currency ?? null, paid?.amount ?? null, items[0].id, coins, wasDuplicate, tier]
  );

  // Журнал: монети зі скриньки. Списання за неї записала купівля.
  await client.query(
    `insert into ledger_entries (user_id, delta_yellow, reason, ref_type, ref_id, meta)
     values ($1, $2, 'crate', 'crate_opening', $3, $4)`,
    [userId, coins, opening[0].id, { tier, item: def.code, was_duplicate: wasDuplicate, source }]
  );

  return {
    openingId: opening[0].id,
    result: {
      item: { ...def, user_item_id: items[0].id },
      coins,
      was_duplicate: wasDuplicate,
      tier,
      balance_yellow: balance[0].coins_yellow,
    },
  };
}

const sendError = (reply, e, price) => {
  if (e.code === "not_enough_coins") return reply.code(409).send({ error: "not_enough_coins", need: price, have: e.have });
  if (e.code === "no_crates") return reply.code(409).send({ error: "no_crates" });
  if (e.code === "no_items_for_tier") return reply.code(503).send({ error: "no_items_for_tier" });
  throw e;
};

const unopened = async (client, userId) => {
  const { rows } = await client.query(
    "select count(*)::int as n from user_crates where user_id = $1 and opened_at is null", [userId]);
  return rows[0].n;
};

export default async function routes(app) {
  app.post("/shop/crate/buy", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const price = economy.crate.price_coins;
    try {
      return await tx(async (client) => {
        // Скринька — з крамниці монет, тож платять будь-якими: спершу
        // срібні, потім жовті (economy §2.1 — нарівні; жовті вигідніше
        // лишити, їх можна переказати). Рядок блокуємо — без гонки між
        // перевіркою й списанням.
        const { rows: bal } = await client.query(
          "select coins_silver, coins_yellow from users where id = $1 for update", [user.id]);
        const have = bal[0].coins_silver + bal[0].coins_yellow;
        if (have < price) throw coded("not_enough_coins", { have });
        const fromSilver = Math.min(bal[0].coins_silver, price);
        const fromYellow = price - fromSilver;
        await client.query(
          "update users set coins_silver = coins_silver - $2, coins_yellow = coins_yellow - $3 where id = $1",
          [user.id, fromSilver, fromYellow]
        );
        const { rows: crate } = await client.query(
          `insert into user_crates (user_id, source, paid_currency, paid_amount)
           values ($1, 'coins', 'yellow', $2) returning id`,
          [user.id, price]
        );
        await client.query(
          `insert into ledger_entries (user_id, delta_silver, delta_yellow, reason, ref_type, ref_id)
           values ($1, $2, $3, 'crate', 'user_crate', $4)`,
          [user.id, -fromSilver, -fromYellow, crate[0].id]
        );
        return { ok: true, crates: await unopened(client, user.id) };
      });
    } catch (e) {
      return sendError(reply, e, price);
    }
  });

  // Скринька зі складу: найстаріша невідкрита. skip locked — два тапи
  // поспіль відкриють дві різні скриньки, а не одну двічі.
  app.post("/me/crates/open", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    try {
      return await tx(async (client) => {
        const { rows } = await client.query(
          `select id, source, paid_currency, paid_amount from user_crates
            where user_id = $1 and opened_at is null
            order by acquired_at limit 1 for update skip locked`,
          [user.id]
        );
        if (!rows.length) throw coded("no_crates");
        const crate = rows[0];
        const { openingId, result } = await openCrate(client, user.id, {
          source: crate.source,
          paid: crate.paid_currency ? { currency: crate.paid_currency, amount: crate.paid_amount } : null,
        });
        await client.query("update user_crates set opened_at = now(), opening_id = $2 where id = $1", [crate.id, openingId]);
        return { ...result, crates_left: await unopened(client, user.id) };
      });
    } catch (e) {
      return sendError(reply, e, 0);
    }
  });
}
