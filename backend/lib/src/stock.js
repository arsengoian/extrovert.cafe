// Облік залишків: налаштування, розрахунковий залишок на будь-яку мить і
// прогноз витрати (docs/stock.md). Спільне для api (екран «Залишки»,
// інвентаризації, «Фінанси»), scheduler (витрата за замовленнями й щоденний
// журнал, jobs/stock.js) і overseer (рядок «запаси» на «Здоровʼї»).
//
// Модель свідомо проста, бо даних мало (точка продає з 05.10.2026, кілька
// чашок на добу): кількість напоїв за київську добу = рівень × тренд ×
// коефіцієнт дня тижня, розкид — надрозсіяний Пуассон за фактичними
// відхиленнями плюс невизначеність рівня й тренду; витрата матеріалу —
// напої × частки напоїв × рецепт. Коефіцієнти дня тижня й тренд стягнуті до
// «без впливу», поки історії мало: інакше два понеділки зробили б з
// понеділка свято.

// Період «запасу вистачить на N днів» (рядок на «Здоровʼї») і «за скільки
// днів до інвентаризації» брати прогноз для порівняння — з конфіга
// (власник: «або інший фіксований період з конфіга»). Допуск розбіжності на
// інвентаризації: більше з 5 % розрахункової витрати, двох σ і невеликої
// абсолютної межі на одиницю (піврядка ваги чи пару штук).
export const STOCK = {
  coverDays: Number(process.env.STOCK_COVER_DAYS) || 14,
  compareDays: Number(process.env.STOCK_COMPARE_DAYS) || 7,
  marginPct: 0.05,
  marginSigma: 2,
  marginAbs: { g: 20, ml: 1000, pcs: 2 },
  // Горизонт кривої прогнозу в журналі: на кожну добу вперед — сукупне
  // середнє й дисперсія, щоб прогноз «за X днів до» читався для будь-якого X.
  curveDays: 30,
  historyDays: 56,
  mixDays: 28,
  // Квантиль 90 %: «вистачить на N днів з імовірністю 90 %».
  z90: 1.2816,
};

const DAY = 86400_000;
const TZ = "Europe/Kyiv";
const KYIV_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

// Київська доба мітки часу: "2026-10-18".
export const kyivDay = (t) => KYIV_DAY.format(new Date(t));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// 0 — понеділок … 6 — неділя.
const dow = (day) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

// ── розрахунковий залишок ───────────────────────────────────────────────
// Залишок на мить `at`: остання інвентаризація до неї (що рахувала цей
// матеріал) + закупки після неї − розрахункова витрата після неї (за
// замовленнями й щодобова). Без інвентаризації — від першої закупки. Ні
// інвентаризації, ні закупки — залишок невідомий (null), а не нуль.
// strict — інвентаризацію рівно в мить `at` не брати: так рахується
// «очікувано» для самої цієї інвентаризації.
export async function bookAt(db, at, { strict = false } = {}) {
  const { rows } = await db.query(
    `with last_count as (
       select distinct on (l.item_id) l.item_id, c.counted_at, sum(l.qty) as qty
         from stock_count_lines l join stock_counts c on c.id = l.count_id
        where ${strict ? "c.counted_at < $1" : "c.counted_at <= $1"}
        group by l.item_id, c.id, c.counted_at
        order by l.item_id, c.counted_at desc
     )
     select i.id as item_id, i.unit, i.per_day::float as per_day,
            lc.counted_at, lc.qty::float as count_qty,
            coalesce((select sum(pl.qty) from stock_purchase_lines pl join stock_purchases p on p.id = pl.purchase_id
                       where pl.item_id = i.id and p.received_at <= $1
                         and (lc.counted_at is null or p.received_at > lc.counted_at)), 0)::float as bought,
            coalesce((select sum(u.qty) from stock_usage u
                       where u.item_id = i.id and u.used_at <= $1
                         and (lc.counted_at is null or u.used_at > lc.counted_at)), 0)::float as used,
            coalesce((select sum(u.var) from stock_usage u
                       where u.item_id = i.id and u.used_at <= $1
                         and (lc.counted_at is null or u.used_at > lc.counted_at)), 0)::float as used_var,
            (select min(p.received_at) from stock_purchase_lines pl join stock_purchases p on p.id = pl.purchase_id
              where pl.item_id = i.id and p.received_at <= $1) as first_in
       from stock_items i left join last_count lc on lc.item_id = i.id
      order by i.sort_order, i.id`,
    [new Date(at).toISOString()]
  );
  return rows.map((r) => {
    const from = r.counted_at ?? r.first_in;
    const days = from ? Math.max(0, (new Date(at) - new Date(from)) / DAY) : 0;
    const daily = r.per_day * days;
    const known = r.counted_at !== null || r.first_in !== null;
    return {
      ...r,
      used: r.used + daily,
      book: known ? (r.count_qty ?? 0) + r.bought - r.used - daily : null,
      book_sd: Math.sqrt(Math.max(0, r.used_var)),
    };
  });
}

// ── попит ───────────────────────────────────────────────────────────────
// Напої, що їх купили (не тестові, лише продукти з меню — окріп за 1 ₴ для
// перевірки термінала й чистки сюди не входять), по київських добах від
// `from` до `to` включно, з нулями для діб без продажів.
export async function dailyDrinks(db, from, to) {
  const { rows } = await db.query(
    `select to_char(o.purchased_at at time zone '${TZ}', 'YYYY-MM-DD') as day, count(*)::int as n
       from machine_orders o
      where o.status = 'Успішно' and o.pay_type is distinct from 'test'
        and o.product_id in (select slot::int from drinks where slot ~ '^\\d+$')
        and (o.purchased_at at time zone '${TZ}')::date between $1::date and $2::date
      group by 1`,
    [from, to]
  );
  const got = new Map(rows.map((r) => [r.day, r.n]));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, n: got.get(d) ?? 0 });
  return days;
}

// Частки напоїв за останні mixDays діб до `to`, стягнуті до рівних
// (α = 2 уявні покупки): один випадковий шоколад не має важити як половина
// меню.
export async function productShares(db, to, products) {
  const { rows } = await db.query(
    `select o.product_id, count(*)::int as n
       from machine_orders o
      where o.status = 'Успішно' and o.pay_type is distinct from 'test'
        and (o.purchased_at at time zone '${TZ}')::date between $1::date - $2::int and $1::date
      group by 1`,
    [to, STOCK.mixDays]
  );
  const counts = new Map(rows.filter((r) => products.includes(r.product_id)).map((r) => [r.product_id, r.n]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const alpha = 2;
  return new Map(products.map((p) => [p, ((counts.get(p) ?? 0) + alpha / products.length) / (total + alpha)]));
}

// Модель кількості напоїв за добу з історії (від старої доби до нової,
// без пропусків). Повертає рівень на останню добу, тренд за добу,
// коефіцієнти днів тижня, надрозсіяність φ і дисперсії рівня й тренду.
export function demandModel(days) {
  const n = days.length;
  if (!n) return null;
  const mean = days.reduce((s, d) => s + d.n, 0) / n;
  // День тижня: середнє дня, стягнуте до загального двома уявними днями.
  const K = 2;
  const sum = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const d of days) { sum[dow(d.day)] += d.n; cnt[dow(d.day)]++; }
  let week = sum.map((s, i) => (mean > 0 ? (s + K * mean) / (cnt[i] + K) / mean : 1));
  const wm = week.reduce((a, b) => a + b, 0) / 7;
  week = week.map((w) => w / wm);

  // Рівень і тренд — зважена регресія без дня тижня, свіжі доби важать
  // більше (піврозпад 21 доба). Тренд стягнутий до нуля, поки діб мало.
  const half = 21;
  const pts = days.map((d, t) => ({ t, v: d.n / week[dow(d.day)], w: 0.5 ** ((n - 1 - t) / half) }));
  const W = pts.reduce((s, p) => s + p.w, 0);
  const W2 = pts.reduce((s, p) => s + p.w * p.w, 0);
  const tbar = pts.reduce((s, p) => s + p.w * p.t, 0) / W;
  const vbar = pts.reduce((s, p) => s + p.w * p.v, 0) / W;
  const Stt = pts.reduce((s, p) => s + p.w * (p.t - tbar) ** 2, 0);
  const Stv = pts.reduce((s, p) => s + p.w * (p.t - tbar) * (p.v - vbar), 0);
  const shrink = n / (n + 28);
  const trend = Stt > 0 ? (Stv / Stt) * shrink : 0;
  const a = vbar - trend * tbar;
  const level = Math.max(0, a + trend * (n - 1));

  // Надрозсіяність: наскільки доби розкидані сильніше, ніж у Пуассона.
  let chi = 0;
  for (const p of pts) {
    const fit = Math.max(0.2, (a + trend * p.t) * week[dow(days[p.t].day)]);
    chi += (days[p.t].n - fit) ** 2 / fit;
  }
  const phi = Math.max(1, chi / Math.max(1, n - 2));
  const neff = (W * W) / W2;
  const base = phi * Math.max(vbar, 0.5);
  return {
    n, level, trend, week, phi, lastDay: days[n - 1].day,
    varLevel: base / Math.max(1, neff),
    varTrend: Stt > 0 ? (base / Stt) * shrink * shrink : 0,
  };
}

// Напої на H діб уперед від доби після model.lastDay: сукупне середнє й
// дисперсія на кожну добу (індекс 0 — перша доба). done — скільки напоїв
// уже продано в першу добу (сьогодні до цієї миті): їх із першої доби
// віднімаємо, бо витрата за них уже в залишку.
export function drinksCurve(model, H, done = 0) {
  const mean = [];
  const variance = [];
  let m = 0, vDay = 0, sw = 0, shw = 0;
  for (let h = 1; h <= H; h++) {
    const w = model.week[dow(addDays(model.lastDay, h))];
    let mu = Math.max(0, model.level + model.trend * h) * w;
    if (h === 1) mu = Math.max(0, mu - done);
    m += mu;
    vDay += model.phi * mu;
    sw += w;
    shw += h * w;
    mean.push(m);
    variance.push(vDay + sw * sw * model.varLevel + shw * shw * model.varTrend);
  }
  return { mean, variance };
}

// Витрата матеріалів на один куплений напій: середнє й дисперсія за
// частками напоїв і рядками рецепта (рядки product_id 0 — на кожен напій).
// Дисперсія — і від того, ЯКИЙ напій купили, і від того, чи взяли кришку.
export function perDrink(lines, shares) {
  const any = lines.filter((l) => l.product_id === 0);
  const items = new Map();
  for (const [product, share] of shares) {
    const own = lines.filter((l) => l.product_id === product);
    const per = new Map();
    for (const l of [...own, ...(own.length ? any : [])]) {
      const q = Number(l.qty), p = Number(l.take_rate);
      const cur = per.get(l.item_id) ?? { m: 0, v: 0 };
      per.set(l.item_id, { m: cur.m + q * p, v: cur.v + q * q * p * (1 - p) });
    }
    for (const [item, { m, v }] of per) {
      const cur = items.get(item) ?? { m: 0, m2: 0, v: 0 };
      items.set(item, { m: cur.m + share * m, m2: cur.m2 + share * m * m, v: cur.v + share * v });
    }
  }
  return new Map([...items].map(([item, x]) => [item, { mean: x.m, var: Math.max(0, x.m2 - x.m * x.m + x.v) }]));
}

// Сукупна витрата матеріалу на кожну добу вперед: напої × витрата на напій
// + щодобова. Дисперсія суми випадкової кількості напоїв:
// E[N]·Var(c) + Var(N)·E[c]².
export function itemCurve(drinks, per, perDay = 0) {
  const c = per ?? { mean: 0, var: 0 };
  return {
    mean: drinks.mean.map((n, i) => n * c.mean + perDay * (i + 1)),
    variance: drinks.mean.map((n, i) => n * c.var + drinks.variance[i] * c.mean * c.mean),
  };
}

// На скільки діб вистачить залишку: за середнім і з імовірністю 90 %. За
// межею кривої — тим самим темпом, що в її останній тиждень (до року).
export function coverDays(stock, curve) {
  if (stock === null || stock === undefined) return { mean: null, p90: null };
  if (stock <= 0) return { mean: 0, p90: 0 };
  const H = curve.mean.length;
  const at = (arr, i) => (i < H ? arr[i] : arr[H - 1] + ((arr[H - 1] - arr[Math.max(0, H - 8)]) / Math.min(7, H - 1 || 1)) * (i - H + 1));
  const find = (value) => {
    let prev = 0;
    for (let i = 0; i < 365; i++) {
      const cur = value(i);
      if (cur >= stock) return Math.round((i + (cur > prev ? (stock - prev) / (cur - prev) : 1)) * 10) / 10;
      prev = cur;
    }
    return null;   // більше року — «вистачить надовго»
  };
  return {
    mean: find((i) => at(curve.mean, i)),
    p90: find((i) => at(curve.mean, i) + STOCK.z90 * Math.sqrt(Math.max(0, at(curve.variance, i)))),
  };
}

// Рядки рецепта, чинного на мить `at`.
export async function recipeAt(db, at) {
  const { rows } = await db.query(
    `select l.product_id, l.item_id, l.qty::float as qty, l.take_rate::float as take_rate, v.id as version_id
       from recipe_lines l join recipe_versions v on v.id = l.version_id
      where v.id = (select id from recipe_versions where valid_from <= $1 order by valid_from desc limit 1)`,
    [new Date(at).toISOString()]
  );
  return rows;
}

// Продукти-напої версії рецепта: ті, що мають стакан (пакування). Окріп
// для перевірки термінала стакана не має й напоєм не вважається.
export async function drinkProducts(db, lines) {
  const { rows } = await db.query("select id from stock_items where kind = 'packaging'");
  const pack = new Set(rows.map((r) => r.id));
  return [...new Set(lines.filter((l) => l.product_id > 0 && pack.has(l.item_id)).map((l) => l.product_id))];
}

// Прогноз на мить `at` для всіх матеріалів: історія попиту до `asOfDay`
// включно (повні доби, що вже минули), сьогоднішні продані напої
// віднімаються з першої доби кривої. → Map(item → крива).
export async function forecastAt(db, at, { asOfDay, doneToday = 0 } = {}) {
  const lines = await recipeAt(db, at);
  if (!lines.length) return { curves: new Map(), model: null };
  const products = await drinkProducts(db, lines);
  const { rows: [first] } = await db.query(
    `select to_char(min(purchased_at) at time zone '${TZ}', 'YYYY-MM-DD') as day from machine_orders where status = 'Успішно'`
  );
  const end = asOfDay ?? addDays(kyivDay(at), -1);
  const start = first?.day && first.day > addDays(end, -STOCK.historyDays + 1) ? first.day : addDays(end, -STOCK.historyDays + 1);
  if (!first?.day || start > end) return { curves: new Map(), model: null };
  const days = await dailyDrinks(db, start, end);
  const model = demandModel(days);
  const shares = await productShares(db, end, products);
  const per = perDrink(lines, shares);
  const drinks = drinksCurve(model, STOCK.curveDays, doneToday);
  const { rows: items } = await db.query("select id, per_day::float as per_day from stock_items where active");
  const curves = new Map(items.map((i) => [i.id, itemCurve(drinks, per.get(i.id), i.per_day)]));
  return { curves, model, drinks, per };
}

// Крива — у журнал: сукупні середнє й дисперсія на кожну добу, округлені.
export const curveJson = (curve) => ({
  mean: curve.mean.map((x) => Math.round(x * 1000) / 1000),
  var: curve.variance.map((x) => Math.round(x * 1000) / 1000),
});

// Сукупна витрата за `days` діб із кривої журналу (дробові доби —
// лінійно між сусідніми).
export function curveAt(json, days) {
  if (!json?.mean?.length || days <= 0) return { mean: 0, sd: 0 };
  const H = json.mean.length;
  const pick = (arr) => {
    const x = Math.min(days, H);
    const i = Math.floor(x);
    const lo = i === 0 ? 0 : arr[i - 1];
    const hi = arr[Math.min(i, H - 1)];
    return lo + (hi - lo) * (x - i);
  };
  return { mean: pick(json.mean), sd: Math.sqrt(Math.max(0, pick(json.var))) };
}

// Допуск розбіжності інвентаризації для матеріалу.
export const margin = (unit, used, sd) =>
  Math.max(STOCK.marginPct * Math.abs(used), STOCK.marginSigma * sd, STOCK.marginAbs[unit] ?? 0);

// ── витрата за замовленнями ─────────────────────────────────────────────
// Версія рецепта, чинна на мить замовлення `o`.
const VERSION_OF = "(select v.id from recipe_versions v where v.valid_from <= o.purchased_at order by v.valid_from desc limit 1)";

// Витрата кожного замовлення машини за рецептом, чинним на мить покупки
// (stock_usage). Рядки, порахувані за іншою версією (з'явилась нова заднім
// числом чи версію прибрали), стираються й рахуються заново. Кличуть
// scheduler (раз на 10 хв) і api одразу після зміни рецепта — щоб залишок
// на екрані не чекав наступного проходу.
export async function syncUsage(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const stale = await client.query(
      `delete from stock_usage u using machine_orders o
        where o.id = u.machine_order_id and u.recipe_version_id is distinct from ${VERSION_OF}`
    );
    // Рядки «на кожен напій» (product_id 0: мішалка, цукор) — лише для
    // куплених напоїв зі стаканом: тестова чашка техніка й окріп для
    // перевірки термінала мішалки не забирають.
    const fresh = await client.query(
      `with o as (
         select o.id, o.product_id, o.purchased_at, o.pay_type, ${VERSION_OF} as version_id
           from machine_orders o
          where o.status = 'Успішно' and o.purchased_at is not null
            and not exists (select 1 from stock_usage u where u.machine_order_id = o.id)
       ),
       drink as (
         select distinct l.version_id, l.product_id
           from recipe_lines l join stock_items i on i.id = l.item_id
          where i.kind = 'packaging' and l.product_id > 0
       )
       insert into stock_usage (machine_order_id, item_id, recipe_version_id, used_at, qty, var)
       select o.id, l.item_id, o.version_id, o.purchased_at,
              sum(l.qty * l.take_rate), sum(l.qty * l.qty * l.take_rate * (1 - l.take_rate))
         from o join recipe_lines l on l.version_id = o.version_id
          and (l.product_id = o.product_id
               or (l.product_id = 0 and o.pay_type is distinct from 'test'
                   and exists (select 1 from drink d where d.version_id = o.version_id and d.product_id = o.product_id)))
        where o.version_id is not null
        group by 1, 2, 3, 4
       on conflict do nothing`
    );
    await client.query("commit");
    return { stale: stale.rowCount, fresh: fresh.rowCount };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── собівартість ────────────────────────────────────────────────────────
// Середня ціна одиниці матеріалу за всі закупки: Σ вартість / Σ кількість.
// Подарунки (нульова ціна) теж у знаменнику — це товар, що дістався
// задарма, і собівартість чашки з нього справді нижча.
export async function unitCosts(db) {
  const { rows } = await db.query(
    `select item_id, (sum(cost_uah) / nullif(sum(qty), 0))::float as unit_cost
       from stock_purchase_lines where kind = 'material' group by 1`
  );
  return new Map(rows.map((r) => [r.item_id, r.unit_cost]));
}

// ── стан запасів зараз ──────────────────────────────────────────────────
// По кожному активному матеріалу: розрахунковий залишок наживо, прогноз
// витрати з сьогоднішнього рядка журналу й «на скільки вистачить». Статус:
//   ok      — з імовірністю 90 % вистачить на STOCK.coverDays;
//   low     — ні;
//   unknown — залишку не знаємо (ні закупки, ні інвентаризації);
//   nonorm  — норми витрати немає (ні в рецепті, ні щодобової), прогнозу теж.
// Цим самим рахує й overseer рядок «запаси» на «Здоровʼї» — щоб екран і
// алерт не сперечались.
export async function stockStatus(db, at = new Date()) {
  const book = await bookAt(db, at);
  const { rows: items } = await db.query(
    `select id, name, unit, pack_size::float as pack_size, pack_name, kind, per_day::float as per_day, canister, sort_order, note
       from stock_items where active order by sort_order, id`
  );
  const { rows: journal } = await db.query(
    `select distinct on (item_id) item_id, day::text as day, as_of, forecast
       from stock_daily order by item_id, day desc`
  );
  const lines = await recipeAt(db, at);
  const normed = new Set(lines.map((l) => l.item_id));
  const costs = await unitCosts(db);
  const byItem = new Map(book.map((b) => [b.item_id, b]));
  const curves = new Map(journal.map((j) => [j.item_id, j]));
  return items.map((i) => {
    const b = byItem.get(i.id);
    const j = curves.get(i.id);
    const curve = j?.forecast?.mean ? { mean: j.forecast.mean, variance: j.forecast.var } : null;
    const hasNorm = normed.has(i.id) || i.per_day > 0;
    const cover = curve && hasNorm ? coverDays(b?.book ?? null, curve) : { mean: null, p90: null };
    const need = curve && hasNorm ? curveAt(j.forecast, STOCK.coverDays) : null;
    const status = b?.book === null || b?.book === undefined ? "unknown"
      : !hasNorm || !need?.mean ? "nonorm"
      : cover.p90 === null || cover.p90 >= STOCK.coverDays ? "ok" : "low";
    const unitCost = costs.get(i.id) ?? null;
    return {
      ...i,
      book: b?.book ?? null,
      book_sd: b?.book_sd ?? 0,
      counted_at: b?.counted_at ?? null,
      unit_cost: unitCost,
      value: unitCost !== null && b?.book !== null && b?.book !== undefined ? Math.max(0, b.book) * unitCost : null,
      forecast_day: j?.day ?? null,
      need,                       // витрата за coverDays: { mean, sd }
      cover_days: cover.mean,     // null — понад рік (або норми немає)
      cover_days_p90: cover.p90,
      status,
    };
  });
}
