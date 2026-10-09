// Покупки в Магазині, які не потребують доставки: препарати, саджанець,
// одяг напряму, обмін зерен і знижка в кавʼярні.
//
// Усе через один роут: списання, видача й запис у журнал відрізняються
// лише кількома рядками, а спільними лишаються правила — ціна з
// economy.json, баланс перевіряється тим самим `where balance >= price`,
// і жодна видача не відбувається поза транзакцією списання.
//
// Доставка Новою Поштою — окремий флоу (адреса, розміри, статуси), тому
// сюди не входить.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { flushNotices } from "../notify.js";
import { pickFaceSet } from "../faceSets.js";
import { queueDiscount } from "@extrovert/lib/discounts.js";

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
export async function spendCoins(client, userId, amount, reason, meta) {
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
        // Обличчя — з тих наборів, яких у гравця ще немає (faceSets.js).
        const { rows } = await client.query(
          "insert into plants (owner_id, face_set_id) values ($1, $2) returning id, face_set_id",
          [user.id, await pickFaceSet(client, user.id)]
        );
        // Кущ зʼявився — віддаємо в його чат те, що чекало без куща.
        await flushNotices(client, user.id, rows[0].id);
        return { ok: true, kind: "sapling", plant_id: rows[0].id, spent };
      });
    }

    // ── обмін зерен на монети ────────────────────────────────────────
    // Скільки завгодно зерен за раз, аж до всіх, що є (власник, 27.09.2026).
    // Верхньої межі, крім балансу, немає: update нижче сам відмовить, якщо
    // зерен менше. Раніше межа була 100, а «abc» у amount давало NaN монет.
    if (code === "beans_to_coins") {
      const beans = Math.floor(Number(req.body?.amount ?? 1));
      if (!Number.isFinite(beans) || beans < 1) fail(400, "bad_amount");
      const coins = beans * economy.beans.rate_coins;
      // Один запит і один рядок журналу на обидві сторони: мінус зерна й
      // плюс монети — це одна операція, і в журналі вона має бути одна
      // (власник, 28.09.2026; раніше spend() і доплата писали два рядки).
      return tx(async (client) => {
        const { rows } = await client.query(
          `update users set beans = beans - $2, coins_yellow = coins_yellow + $3
            where id = $1 and beans >= $2 returning beans`,
          [user.id, beans, coins]
        );
        if (!rows.length) fail(409, "not_enough", { currency: "beans", need: beans });
        await client.query(
          `insert into ledger_entries (user_id, delta_beans, delta_yellow, reason, meta)
           values ($1, $2, $3, 'exchange', $4)`,
          [user.id, -beans, coins, { beans, coins }]
        );
        return { ok: true, kind: "exchange", beans, coins };
      });
    }

    // ── знижка в кав'ярні ────────────────────────────────────────────
    // Не код, а тимчасова ціна на точці: знижка стає в чергу точки й діє
    // window_s секунд або до першого чека, а не доїхала — зерна повернуться
    // самі (lib/discounts.js, gamification_economy.md §6). Точка — з запиту,
    // а коли її не передали й точка одна, то вона. Продається з 28.09.2026
    // (власник): перед релізом вимкнемо (available: false), якщо ціна не
    // доїжджатиме до автомата Jetinno — цілі jetinno поки немає.
    if (code === "pos_discount") {
      const cfg = economy.shop_beans.pos_discount;
      if (!cfg.available) fail(409, "not_available");
      const asked = req.body?.point ? String(req.body.point) : null;
      const points = await many(
        "select id, name from points where status <> 'retired' and ($1::text is null or id = $1) order by id", [asked]);
      if (!points.length) fail(404, "no_such_point");
      if (points.length > 1) fail(400, "point_required", { points: points.map((p) => ({ id: p.id, name: p.name })) });
      const point = points[0];
      // Знижка діє на один напій, який обирає гравець (власник, 08.10.2026):
      // машина міняє ціну окремо на кожен напій. Напій має бути активним і не
      // бонусним (бонусний і так коштує монети, не гривні).
      const drinkSlot = req.body?.drink ? String(req.body.drink) : null;
      const drink = drinkSlot
        ? await one("select slot, name from drinks where slot = $1 and active and not is_bonus", [drinkSlot])
        : null;
      if (!drink) fail(400, "drink_required", {
        drinks: (await many("select slot, name from drinks where active and not is_bonus order by sort_order, name"))
          .map((d) => ({ slot: d.slot, name: d.name })),
      });
      return tx(async (client) => {
        const spent = await spend(client, user.id, "beans", cfg.beans, "pos_discount", { uah: cfg.uah, point: point.id, drink: drink.slot });
        const q = await queueDiscount(client, point.id, {
          uah: cfg.uah, seconds: cfg.window_s ?? 120, userId: user.id, ledgerEntryId: spent.ledgerId, drinkSlot: drink.slot,
        });
        return {
          ok: true, kind: "pos_discount", amount_uah: cfg.uah, point: point.id, point_name: point.name,
          drink: drink.slot, drink_name: drink.name,
          seconds: cfg.window_s ?? 120, status: q.status, ahead: q.ahead, until: q.ends_at,
        };
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
