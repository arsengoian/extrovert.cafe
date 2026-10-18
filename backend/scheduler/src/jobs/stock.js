// Облік залишків за розкладом (docs/stock.md):
//
// 1. Витрата за кожним замовленням машини — за рецептом, чинним на мить
//    покупки (stock_usage). Нова версія рецепта заднім числом — рядки старої
//    версії стираються й рахуються заново.
// 2. Щоденний журнал (stock_daily): розрахунковий залишок, витрата за добу й
//    прогноз уперед. Сьогоднішній рядок переписується щоразу, минулі — ні:
//    це те, що ми знали того дня, і з ним інвентаризація порівнює прогноз
//    «за X днів до». Доби, яких у журналі немає (перший запуск, простій),
//    дораховуються тим самим кодом лише з даних, що були на кінець доби.
//
// Частота — раз на десять хвилин: замовлення машини приходять із порталу
// раз на пів години, а запасу на години наперед вистачає завжди.
import { addDays, bookAt, coverDays, curveJson, forecastAt, kyivDay, syncUsage } from "@extrovert/lib/stock.js";

const TZ = "Europe/Kyiv";
const DRINK = `o.status = 'Успішно' and o.pay_type is distinct from 'test'
               and o.product_id in (select slot::int from drinks where slot ~ '^\\d+$')`;

// Межі київської доби: [початок, кінець).
async function dayBounds(db, day) {
  const { rows: [r] } = await db.query(
    `select ($1::date::timestamp at time zone '${TZ}') as a, (($1::date + 1)::timestamp at time zone '${TZ}') as b`,
    [day]
  );
  return [r.a, r.b];
}

async function snapshot(db, day, today) {
  const [start, endOfDay] = await dayBounds(db, day);
  const at = today ? new Date() : endOfDay;
  const book = await bookAt(db, at);
  const { rows: used } = await db.query(
    `select item_id, sum(qty)::float as qty, sum(var)::float as var
       from stock_usage where used_at >= $1 and used_at < $2 group by 1`,
    [start, at]
  );
  const usedBy = new Map(used.map((u) => [u.item_id, u]));
  // Сьогодні крива йде від цієї миті: продані вже напої з першої доби
  // віднімаються. Минула доба — від її кінця, з історією по неї включно.
  let opts = { asOfDay: day };
  if (today) {
    const { rows: [d] } = await db.query(`select count(*)::int as n from machine_orders o where ${DRINK} and o.purchased_at >= $1`, [start]);
    opts = { asOfDay: addDays(day, -1), doneToday: d.n };
  }
  const { curves } = await forecastAt(db, at, opts);
  const share = Math.min(1, (at - start) / 86400_000);
  for (const b of book) {
    const curve = curves.get(b.item_id);
    const u = usedBy.get(b.item_id);
    const cover = curve ? coverDays(b.book, curve) : { mean: null, p90: null };
    await db.query(
      `insert into stock_daily (day, item_id, as_of, book_qty, used_qty, used_var, forecast, cover_days, cover_days_p90, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (day, item_id) do update set
         as_of = excluded.as_of, book_qty = excluded.book_qty, used_qty = excluded.used_qty, used_var = excluded.used_var,
         forecast = excluded.forecast, cover_days = excluded.cover_days, cover_days_p90 = excluded.cover_days_p90,
         computed_at = now()`,
      [day, b.item_id, at, b.book, (u?.qty ?? 0) + b.per_day * share, u?.var ?? 0,
       curve ? curveJson(curve) : null, cover.mean, cover.p90]
    );
  }
}

async function journal(pool) {
  const { rows: [first] } = await pool.query(
    `select least(
       (select min(p.received_at) from stock_purchases p join stock_purchase_lines l on l.purchase_id = p.id where l.kind = 'material'),
       (select min(counted_at) from stock_counts),
       (select min(purchased_at) from machine_orders where status = 'Успішно')) as t`
  );
  if (!first?.t) return 0;
  const today = kyivDay(Date.now());
  const { rows: have } = await pool.query("select distinct day::text as day from stock_daily");
  const done = new Set(have.map((h) => h.day));
  let n = 0;
  for (let day = kyivDay(first.t); day <= today; day = addDays(day, 1)) {
    if (day !== today && done.has(day)) continue;
    await snapshot(pool, day, day === today);
    n++;
  }
  return n;
}

export async function runStock({ pool, log }) {
  const usage = await syncUsage(pool);
  const days = await journal(pool);
  if (usage.stale || usage.fresh || days > 1) {
    return { done: `витрата: +${usage.fresh} рядків, перераховано ${usage.stale}; журнал: ${days} діб`, extra: usage };
  }
  return {};
}
