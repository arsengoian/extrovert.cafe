// Покупки в Магазині, які не потребують доставки: препарати, саджанець,
// одяг напряму, обмін зерен і знижка на POS.
//
// Усе через один роут: списання, видача й запис у журнал відрізняються
// лише кількома рядками, а спільними лишаються правила — ціна з
// economy.json, баланс перевіряється тим самим `where balance >= price`,
// і жодна видача не відбувається поза транзакцією списання.
//
// Доставка Новою Поштою — окремий флоу (адреса, розміри, статуси), тому
// сюди не входить.
import { one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { flushNotices, notifyPlant } from "../notify.js";

const CARE = {
  water: { column: "water_liters", amount: economy.care.water.batch_liters, price: economy.care.water.price_coins },
  compost: { column: "compost_kg", amount: economy.care.compost.batch_units, price: economy.care.compost.price_coins },
  fertilizer: { column: "fertilizer_kg", amount: economy.care.fertilizer.batch_units, price: economy.care.fertilizer.price_coins },
  insecticide: { column: "insecticide_bottles", amount: economy.care.insecticide.batch_units, price: economy.care.insecticide.price_coins },
};

const BALANCE_COLUMN = { yellow: "coins_yellow", silver: "coins_silver", beans: "beans" };
const DELTA_COLUMN = { yellow: "delta_yellow", silver: "delta_silver", beans: "delta_beans" };

// Списання з перевіркою балансу одним запитом: окрема перевірка «а чи
// вистачить» між select і update — це гонка, яку колись обовʼязково ловлять.
async function spend(client, userId, currency, amount, reason, meta) {
  const column = BALANCE_COLUMN[currency];
  const { rows } = await client.query(
    `update users set ${column} = ${column} - $2 where id = $1 and ${column} >= $2 returning ${column} as left`,
    [userId, amount]
  );
  if (!rows.length) fail(409, "not_enough", { currency, need: amount });
  const { rows: entry } = await client.query(
    `insert into ledger_entries (user_id, ${DELTA_COLUMN[currency]}, reason, meta) values ($1, $2, $3, $4) returning id`,
    [userId, -amount, reason, meta]
  );
  return { left: rows[0].left, ledgerId: entry[0].id };
}

// Спершу витрачаються срібні, потім жовті. Срібні нікуди, крім гри, не
// дінуться, а жовті ще можна переказати іншому гравцю — тож лишати гравцю
// вигідніше саме жовті (economy §2.1: витрачаються вони нарівні).
async function spendCoins(client, userId, amount, reason, meta) {
  const { rows } = await client.query("select coins_silver, coins_yellow from users where id = $1 for update", [userId]);
  const { coins_silver: silver, coins_yellow: yellow } = rows[0];
  if (silver + yellow < amount) fail(409, "not_enough", { currency: "coins", need: amount });
  const fromSilver = Math.min(silver, amount);
  const fromYellow = amount - fromSilver;
  await client.query(
    "update users set coins_silver = coins_silver - $2, coins_yellow = coins_yellow - $3 where id = $1",
    [userId, fromSilver, fromYellow]
  );
  const { rows: entry } = await client.query(
    `insert into ledger_entries (user_id, delta_silver, delta_yellow, reason, meta)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, -fromSilver, -fromYellow, reason, meta]
  );
  return { fromSilver, fromYellow, ledgerId: entry[0].id };
}

const discountCode = () =>
  `EX${Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")}`;

export default async function routes(app) {
  app.post("/shop/buy", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const code = String(req.body?.code ?? "");

    // ── препарати ────────────────────────────────────────────────────
    if (CARE[code]) {
      const { column, amount, price } = CARE[code];
      return tx(async (client) => {
        const spent = await spendCoins(client, user.id, price, "care", { pack: code, amount });
        const { rows } = await client.query(
          `update users set ${column} = ${column} + $2 where id = $1 returning ${column} as have`,
          [user.id, amount]
        );
        return { ok: true, kind: "care", added: amount, have: rows[0].have, spent };
      });
    }

    // ── саджанець ────────────────────────────────────────────────────
    if (code === "sapling" || code === "sapling_beans") {
      const beans = code === "sapling_beans";
      return tx(async (client) => {
        const price = beans ? economy.sapling.price_beans : economy.sapling.price_coins;
        const spent = beans
          ? await spend(client, user.id, "beans", price, "sapling", { paid: "beans" })
          : await spendCoins(client, user.id, price, "sapling", { paid: "coins" });
        // Обличчя обирається випадково: наборів поки один, але id вже
        // зберігається — домалюють решту, і старі кавенятка не зміняться.
        const { rows } = await client.query(
          "insert into plants (owner_id, face_set_id) values ($1, $2) returning id, face_set_id",
          [user.id, 1 + Math.floor(Math.random() * 3)]
        );
        // Кущ зʼявився — віддаємо в його чат те, що чекало без куща.
        await flushNotices(client, user.id, rows[0].id);
        return { ok: true, kind: "sapling", plant_id: rows[0].id, spent };
      });
    }

    // ── обмін зерен на монети ────────────────────────────────────────
    if (code === "beans_to_coins") {
      const beans = Math.max(1, Math.min(100, Number(req.body?.amount ?? 1)));
      const coins = beans * economy.beans.rate_coins;
      return tx(async (client) => {
        await spend(client, user.id, "beans", beans, "exchange", { beans, coins });
        await client.query("update users set coins_yellow = coins_yellow + $2 where id = $1", [user.id, coins]);
        await client.query(
          "insert into ledger_entries (user_id, delta_yellow, reason, meta) values ($1, $2, 'exchange', $3)",
          [user.id, coins, { beans }]
        );
        return { ok: true, kind: "exchange", beans, coins };
      });
    }

    // ── знижка на POS ────────────────────────────────────────────────
    if (code === "pos_discount") {
      const { beans, uah } = economy.shop_beans.pos_discount;
      return tx(async (client) => {
        const spent = await spend(client, user.id, "beans", beans, "pos_discount", { uah });
        const value = discountCode();
        await client.query(
          "insert into pos_discount_codes (ledger_entry_id, user_id, code, amount_uah) values ($1, $2, $3, $4)",
          [spent.ledgerId, user.id, value, uah]
        );
        await notifyPlant(user.id, `Код знижки ${value} на ${uah} грн — введи його на точці перед оплатою.`, { client });
        return { ok: true, kind: "pos_discount", code: value, amount_uah: uah };
      });
    }

    // ── одяг напряму ─────────────────────────────────────────────────
    if (code === "item") {
      const itemCode = String(req.body?.item ?? "");
      const def = await one("select * from item_defs where code = $1 and active", [itemCode]);
      if (!def) fail(404, "no_such_item");
      const price = def.price_coins ?? economy.clothing_direct_price_coins[def.tier];
      if (!price) fail(409, "not_for_sale");
      return tx(async (client) => {
        const spent = await spendCoins(client, user.id, price, "purchase", { item: def.code });
        const { rows } = await client.query(
          "insert into user_items (user_id, item_def_id, acquired_from) values ($1, $2, 'shop') returning id",
          [user.id, def.id]
        );
        return { ok: true, kind: "item", user_item_id: rows[0].id, name: def.name, price, spent };
      });
    }

    fail(400, "unknown_product", { code });
  });
}
