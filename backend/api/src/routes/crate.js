// Відкриття скриньки. Правила — economy §4 і §4.2, і вони тут навмисно
// зібрані в одному місці: рол тіру, предмет, монети, журнал.
//
// Крейт ЗАВЖДИ дає і предмет, і монети. Дубль — нормальний результат:
// він лягає на склад і продається на P2P (§4.2).
import { requireUser } from "../auth.js";
import { tx } from "../db.js";
import { economy, rollCrateCoins, rollTier } from "../economy.js";

export default async function routes(app) {
  app.post("/shop/crate/open", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const price = economy.crate.price_coins;

    try {
      const result = await tx(async (client) => {
        // Списання й перевірка балансу — одним запитом: where ... >= price
        // означає, що нестача це 0 рядків, а не окрема гонка.
        const paid = await client.query(
          `update users set coins_yellow = coins_yellow - $2
            where id = $1 and coins_yellow >= $2
            returning coins_yellow`,
          [user.id, price]
        );
        if (paid.rowCount === 0) {
          const err = new Error("not_enough_coins");
          err.code = "not_enough_coins";
          throw err;
        }

        const tier = rollTier();
        const { rows: defs } = await client.query(
          `select id, code, name, collection, slot, tier, sprite_id, description_md
             from item_defs where active and tier = $1 order by random() limit 1`,
          [tier]
        );
        if (!defs.length) {
          const err = new Error("no_items_for_tier");
          err.code = "no_items_for_tier";
          throw err;
        }
        const def = defs[0];

        const dup = await client.query(
          "select 1 from user_items where user_id = $1 and item_def_id = $2 limit 1",
          [user.id, def.id]
        );
        const wasDuplicate = dup.rowCount > 0;

        const { rows: items } = await client.query(
          `insert into user_items (user_id, item_def_id, acquired_from)
           values ($1, $2, 'crate') returning id`,
          [user.id, def.id]
        );

        const coins = rollCrateCoins();
        const { rows: balance } = await client.query(
          "update users set coins_yellow = coins_yellow + $2 where id = $1 returning coins_yellow",
          [user.id, coins]
        );

        const { rows: opening } = await client.query(
          `insert into crate_openings (user_id, source, paid_currency, paid_amount,
                                       result_item_id, result_coins, was_duplicate, rolled_tier)
           values ($1, 'coins', 'yellow', $2, $3, $4, $5, $6) returning id`,
          [user.id, price, items[0].id, coins, wasDuplicate, tier]
        );

        // Журнал: одна операція — один рядок із чистою дельтою.
        await client.query(
          `insert into ledger_entries (user_id, delta_yellow, reason, ref_type, ref_id, meta)
           values ($1, $2, 'crate', 'crate_opening', $3, $4)`,
          [user.id, coins - price, opening[0].id, { tier, item: def.code, was_duplicate: wasDuplicate }]
        );

        return {
          item: { ...def, user_item_id: items[0].id },
          coins,
          was_duplicate: wasDuplicate,
          tier,
          balance_yellow: balance[0].coins_yellow,
        };
      });

      return result;
    } catch (e) {
      if (e.code === "not_enough_coins") {
        return reply.code(409).send({ error: "not_enough_coins", need: price });
      }
      if (e.code === "no_items_for_tier") {
        return reply.code(503).send({ error: "no_items_for_tier" });
      }
      throw e;
    }
  });
}
