// Облік залишків для адмінки (docs/stock.md): поточні залишки з прогнозом,
// інвентаризації з порівнянням «розрахунок / прогноз / факт», закупки,
// матеріали й рецепти (з імпортом резервної копії рецептів машини).
//
// Розрахунки — у спільній бібліотеці (@extrovert/lib/stock.js): ними ж
// рахує scheduler (витрата за замовленнями, щоденний журнал) і overseer
// (рядок «запаси» на «Здоровʼї»), тож екран і алерт не розходяться.
import { many, one, pool, tx } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { pageInfo, pageOf } from "../paging.js";
import { STOCK, bookAt, curveAt, kyivDay, margin, stockStatus, syncUsage } from "@extrovert/lib/stock.js";

const DAY = 86400_000;
const TZ = "Europe/Kyiv";
const DRINK = `o.status = 'Успішно' and o.pay_type is distinct from 'test'
               and o.product_id in (select slot::int from drinks where slot ~ '^\\d+$')`;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
function moment(v, name) {
  const d = new Date(v);
  if (!v || Number.isNaN(+d)) fail(400, `bad_${name}`);
  if (d - Date.now() > 3600_000) fail(400, `${name}_in_future`);
  return d.toISOString();
}

// ── інвентаризація: порівняння ──────────────────────────────────────────
// По кожному матеріалу, який у ній рахували:
//   очікувано = попередня інвентаризація (або перша закупка) + закупки −
//               розрахункова витрата (за рецептами, чинними на мить кожної
//               покупки, й щодобова), з похибкою σ;
//   різниця   = факт − очікувано; за межею допуску (STOCK, margin) — «over»
//               (витрачено більше, ніж мало б) чи «surplus» (менше);
//   прогноз   = що журнал за X днів до інвентаризації обіцяв на цю мить.
// Матеріал без норми (ні в рецепті, ні щодобової) — «info»: різниці немає з
// чим порівнювати, зате видно фактичну витрату й частку на напій.
async function compare(count, x = STOCK.compareDays) {
  const lines = await many(
    "select item_id, location_id, qty::float as qty from stock_count_lines where count_id = $1",
    [count.id]
  );
  if (!lines.length) return [];
  const items = new Map((await many(
    "select id, name, unit, kind, per_day::float as per_day, pack_size::float as pack_size, pack_name, sort_order from stock_items"
  )).map((i) => [i.id, i]));
  const book = new Map((await bookAt(pool, count.counted_at, { strict: true })).map((b) => [b.item_id, b]));
  // Норма — у будь-якій версії рецепта, чинній за період (від найранішого
  // старту серед матеріалів до цієї інвентаризації), або щодобова.
  const normed = new Set((await many(
    `select distinct l.item_id from recipe_lines l join recipe_versions v on v.id = l.version_id
      where v.valid_from <= $1`,
    [count.counted_at]
  )).map((r) => r.item_id));
  const snapDay = kyivDay(new Date(count.counted_at) - x * DAY);
  const snaps = new Map((await many(
    "select item_id, as_of, book_qty::float as book_qty, forecast from stock_daily where day = $1",
    [snapDay]
  )).map((s) => [s.item_id, s]));

  const byItem = new Map();
  for (const l of lines) {
    const cur = byItem.get(l.item_id) ?? { actual: 0, locations: {} };
    cur.actual += l.qty;
    cur.locations[l.location_id] = l.qty;
    byItem.set(l.item_id, cur);
  }

  const out = [];
  for (const [itemId, { actual, locations }] of byItem) {
    const item = items.get(itemId);
    const b = book.get(itemId);
    const start = b?.counted_at ?? b?.first_in ?? null;
    const expected = b?.book ?? null;
    const sd = b?.book_sd ?? 0;
    const calcUsed = b?.used ?? 0;
    const hasNorm = normed.has(itemId) || item.per_day > 0;
    const tol = margin(item.unit, calcUsed, sd);
    const diff = expected === null ? null : actual - expected;
    const status = expected === null || !hasNorm ? "info" : diff < -tol ? "over" : diff > tol ? "surplus" : "ok";
    // Скільки напоїв купили за той самий період — для частки «на напій».
    const drinks = start
      ? (await one(`select count(*)::int as n from machine_orders o where ${DRINK} and o.purchased_at > $1 and o.purchased_at <= $2`,
          [start, count.counted_at])).n
      : null;
    const actualUsed = expected === null ? null : (b.count_qty ?? 0) + b.bought - actual;
    // Прогноз журналу за X днів до: залишок на ту мить + закупки після неї −
    // прогноз витрати на час, що минув до інвентаризації.
    let projection = null;
    const s = snaps.get(itemId);
    if (s && s.book_qty !== null && s.forecast && new Date(s.as_of) < new Date(count.counted_at)) {
      const bought = (await one(
        `select coalesce(sum(pl.qty), 0)::float as q from stock_purchase_lines pl join stock_purchases p on p.id = pl.purchase_id
          where pl.item_id = $1 and p.received_at > $2 and p.received_at <= $3`,
        [itemId, s.as_of, count.counted_at]
      )).q;
      const elapsed = (new Date(count.counted_at) - new Date(s.as_of)) / DAY;
      const f = curveAt(s.forecast, elapsed);
      projection = { day: snapDay, as_of: s.as_of, calc_then: s.book_qty, projected: s.book_qty + bought - f.mean, sd: f.sd, days: elapsed };
    }
    out.push({
      item_id: itemId, name: item.name, unit: item.unit, kind: item.kind, pack_size: item.pack_size, pack_name: item.pack_name,
      sort_order: item.sort_order, actual, locations,
      prev: b?.counted_at ? { counted_at: b.counted_at, qty: b.count_qty } : null,
      start, bought: b?.bought ?? 0, calc_used: calcUsed, calc_sd: sd, expected, diff, margin: tol, status,
      drinks, actual_used: actualUsed,
      rate_actual: drinks && actualUsed !== null ? actualUsed / drinks : null,
      rate_norm: drinks ? calcUsed / drinks : null,
      projection,
    });
  }
  return out.sort((a, b) => a.sort_order - b.sort_order || a.item_id.localeCompare(b.item_id));
}

// Рядки інвентаризації з тіла запиту: матеріал, місце, кількість ≥ 0.
async function countLines(body) {
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  const items = new Set((await many("select id from stock_items")).map((r) => r.id));
  const locations = new Set((await many("select id from stock_locations")).map((r) => r.id));
  const seen = new Map();
  for (const l of raw) {
    const qty = num(l?.qty);
    if (qty === null) continue;
    if (!items.has(l.item_id)) fail(400, "bad_item", { item_id: l.item_id });
    if (!locations.has(l.location_id)) fail(400, "bad_location", { location_id: l.location_id });
    if (!Number.isFinite(qty) || qty < 0) fail(400, "bad_qty", { item_id: l.item_id });
    seen.set(`${l.item_id}|${l.location_id}`, { item_id: l.item_id, location_id: l.location_id, qty });
  }
  if (!seen.size) fail(400, "no_lines");
  return [...seen.values()];
}

// Рядки закупки: матеріал (з кількістю в базових одиницях) або інша витрата.
async function purchaseLines(body) {
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  const items = new Map((await many("select id, name from stock_items")).map((r) => [r.id, r.name]));
  const out = raw.map((l) => {
    const kind = String(l?.kind ?? "material");
    if (!["material", "capex", "opex"].includes(kind)) fail(400, "bad_kind");
    const cost = num(l?.cost_uah);
    if (cost === null || !Number.isFinite(cost) || cost < 0) fail(400, "bad_cost");
    if (kind === "material") {
      if (!items.has(l?.item_id)) fail(400, "bad_item", { item_id: l?.item_id });
      const qty = num(l?.qty);
      if (qty === null || !Number.isFinite(qty) || qty <= 0) fail(400, "bad_qty", { item_id: l.item_id });
      return { kind, item_id: l.item_id, category: null, description: String(l?.description || items.get(l.item_id)).slice(0, 300), qty, cost_uah: cost };
    }
    const description = String(l?.description ?? "").trim();
    if (!description) fail(400, "bad_description");
    return { kind, item_id: null, category: String(l?.category ?? "").trim().slice(0, 80) || null, description: description.slice(0, 300), qty: null, cost_uah: cost };
  });
  if (!out.length) fail(400, "no_lines");
  return out;
}

async function insertPurchaseLines(client, purchaseId, lines) {
  for (const l of lines) {
    await client.query(
      `insert into stock_purchase_lines (purchase_id, kind, item_id, category, description, qty, cost_uah)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [purchaseId, l.kind, l.item_id, l.category, l.description, l.qty, l.cost_uah]
    );
  }
}

// ── рецепти ─────────────────────────────────────────────────────────────
// Рядки рецепта з тіла запиту.
async function recipeLines(raw) {
  const items = new Set((await many("select id from stock_items")).map((r) => r.id));
  const seen = new Map();
  for (const l of Array.isArray(raw) ? raw : []) {
    const product = Number(l?.product_id), qty = num(l?.qty), rate = num(l?.take_rate) ?? 1;
    if (!Number.isInteger(product) || product < 0) fail(400, "bad_product");
    if (!items.has(l?.item_id)) fail(400, "bad_item", { item_id: l?.item_id });
    if (qty === null || !(qty > 0)) fail(400, "bad_qty", { product_id: product, item_id: l.item_id });
    if (!(rate > 0 && rate <= 1)) fail(400, "bad_take_rate", { product_id: product, item_id: l.item_id });
    seen.set(`${product}|${l.item_id}`, { product_id: product, item_id: l.item_id, qty, take_rate: rate });
  }
  if (!seen.size) fail(400, "no_lines");
  return [...seen.values()];
}

async function createVersion(admin, { validFrom, source, note, products, lines }) {
  const exists = await one("select id from recipe_versions where valid_from = $1", [validFrom]);
  if (exists) fail(409, "version_exists");
  const id = await tx(async (client) => {
    const { rows: [v] } = await client.query(
      `insert into recipe_versions (valid_from, source, note, products, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [validFrom, source, note, JSON.stringify(products ?? {}), admin.id]
    );
    for (const l of lines) {
      await client.query(
        "insert into recipe_lines (version_id, product_id, item_id, qty, take_rate) values ($1, $2, $3, $4, $5)",
        [v.id, l.product_id, l.item_id, l.qty, l.take_rate]
      );
    }
    return v.id;
  });
  // Витрата за замовленнями після valid_from — одразу за новою версією.
  await syncUsage(pool);
  return id;
}

// Версія, чинна на мить `at`, з рядками.
async function versionAt(at) {
  const v = await one("select * from recipe_versions where valid_from <= $1 order by valid_from desc limit 1", [at]);
  if (!v) return null;
  const lines = await many(
    "select product_id, item_id, qty::float as qty, take_rate::float as take_rate from recipe_lines where version_id = $1",
    [v.id]
  );
  return { ...v, lines };
}

// Резервна копія рецептів машини (*.product + *.recipe з Recipe_Product_Zip,
// docs/jetinno.md, «Резервна копія з машини») → рядки рецепта: на кожен
// продукт — грами кроків за бункером (stock_items.canister) і вода — сума
// waterVolume усіх кроків. Стакан, кришка й «на кожен напій» машина не
// знає: їх беремо з чинної версії, а новому продукту — стакан за меню.
async function machineLines(products, recipes, base) {
  const byName = new Map(recipes.map((r) => [r.recipeName, r]));
  const items = await many("select id, canister, kind from stock_items");
  const byCanister = new Map(items.filter((i) => i.canister !== null).map((i) => [String(i.canister), i.id]));
  const water = byCanister.get("0");
  const machineItems = new Set(items.filter((i) => i.canister !== null).map((i) => i.id));
  const unknown = new Set();
  const lines = [];
  const names = {};
  for (const p of products) {
    const id = Number(p?.productId);
    if (!Number.isInteger(id) || id <= 0) continue;
    names[id] = p?.nameLang?.uk_ || p?.nameCN || String(id);
    const recipe = byName.get(p?.recipeName);
    if (!recipe) continue;
    const per = new Map();
    let ml = 0;
    for (const s of recipe.stepses ?? []) {
      ml += Number(s.waterVolume) || 0;
      const canister = String(s.canisterId);
      if (canister === "0") continue;
      const item = byCanister.get(canister);
      if (!item) { unknown.add(canister); continue; }
      per.set(item, (per.get(item) ?? 0) + (Number(s.gradientWeight) || 0));
    }
    if (water && ml > 0) per.set(water, ml);
    for (const [item, qty] of per) if (qty > 0) lines.push({ product_id: id, item_id: item, qty, take_rate: 1 });
  }
  if (unknown.size) fail(400, "unknown_canister", { canisters: [...unknown] });
  if (!lines.length) fail(400, "no_recipes");

  // Не з машини: пакування й «на кожен напій» — з чинної версії.
  const imported = new Set(lines.map((l) => l.product_id));
  const keep = (base?.lines ?? []).filter((l) => !machineItems.has(l.item_id) && (l.product_id === 0 || imported.has(l.product_id)));
  const packed = new Set(keep.filter((l) => l.product_id > 0).map((l) => l.product_id));
  // Новий продукт без пакування — стакан за розміром у меню, кришка (M, L)
  // з тією ж часткою, що в чинній версії.
  const drinks = new Map((await many("select slot::int as product_id, cup from drinks where slot ~ '^\\d+$'")).map((d) => [d.product_id, d.cup]));
  const lidRate = (item) => keep.find((l) => l.item_id === item)?.take_rate ?? 1;
  const extra = [];
  for (const id of imported) {
    if (packed.has(id)) continue;
    const cup = drinks.get(id);
    if (!cup) continue;
    const size = cup.toLowerCase();
    if (items.some((i) => i.id === `cup_${size}`)) extra.push({ product_id: id, item_id: `cup_${size}`, qty: 1, take_rate: 1 });
    if (size !== "s" && items.some((i) => i.id === `lid_${size}`)) extra.push({ product_id: id, item_id: `lid_${size}`, qty: 1, take_rate: lidRate(`lid_${size}`) });
  }
  return { lines: [...lines, ...keep, ...extra], names };
}

export default async function routes(app) {
  // ── поточні залишки ───────────────────────────────────────────────────
  app.get("/admin/stock", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const items = await stockStatus(pool);
    const locations = await many("select id, name, point_id, kind from stock_locations order by sort_order, id");
    const lastCount = await one("select id, counted_at from stock_counts order by counted_at desc, id desc limit 1");
    const value = items.reduce((s, i) => s + (i.value ?? 0), 0);
    return {
      items, locations, last_count: lastCount,
      config: { cover_days: STOCK.coverDays, compare_days: STOCK.compareDays, margin_pct: STOCK.marginPct, margin_sigma: STOCK.marginSigma },
      totals: { value, low: items.filter((i) => i.status === "low").length },
    };
  });

  // Історія одного матеріалу з журналу й прогноз уперед від сьогодні.
  app.get("/admin/stock/history", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const item = String(req.query.item ?? "");
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 60));
    const exists = await one("select id, unit from stock_items where id = $1", [item]);
    if (!exists) fail(404, "no_such_item");
    const history = await many(
      `select day::text as day, as_of, book_qty::float as book, used_qty::float as used
         from stock_daily where item_id = $1 and day > (now() at time zone '${TZ}')::date - $2::int order by day`,
      [item, days]
    );
    const today = await one("select as_of, forecast from stock_daily where item_id = $1 order by day desc limit 1", [item]);
    const live = (await bookAt(pool, new Date())).find((b) => b.item_id === item);
    return { item, unit: exists.unit, history, forecast: today?.forecast ?? null, book: live?.book ?? null };
  });

  // ── інвентаризації ────────────────────────────────────────────────────
  app.get("/admin/stock/counts", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const pg = pageOf(req.query, { per: 20 });
    const latest = await one("select id from stock_counts order by counted_at desc, id desc limit 1");
    const rows = await many(
      `select c.id, c.counted_at, c.note, c.created_by, c.updated_at, count(distinct l.item_id)::int as items
         from stock_counts c left join stock_count_lines l on l.count_id = c.id
        group by c.id order by c.counted_at desc, c.id desc limit $1 offset $2`,
      [pg.per, pg.offset]
    );
    for (const r of rows) {
      const cmp = await compare(r);
      r.latest = r.id === latest?.id;
      r.over = cmp.filter((c) => c.status === "over").length;
      r.surplus = cmp.filter((c) => c.status === "surplus").length;
    }
    const total = await one("select count(*)::int as n from stock_counts");
    return { counts: rows, page: pageInfo(pg, total.n), compare_days: STOCK.compareDays };
  });

  app.get("/admin/stock/counts/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const count = await one("select * from stock_counts where id = $1", [req.params.id]);
    if (!count) fail(404, "no_such_count");
    const latest = await one("select id from stock_counts order by counted_at desc, id desc limit 1");
    const x = Math.min(60, Math.max(1, Number(req.query.x) || STOCK.compareDays));
    return { count: { ...count, latest: count.id === latest.id }, rows: await compare(count, x), compare_days: x };
  });

  // Нова інвентаризація — лише після останньої: це джерело правди на мить
  // підрахунку, і вставлена посередині тихо переписала б історію.
  app.post("/admin/stock/counts", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const countedAt = moment(req.body?.counted_at, "counted_at");
    const lines = await countLines(req.body);
    const last = await one("select counted_at from stock_counts order by counted_at desc limit 1");
    if (last && new Date(countedAt) <= new Date(last.counted_at)) fail(409, "not_after_latest", { latest: last.counted_at });
    const id = await tx(async (client) => {
      const { rows: [c] } = await client.query(
        "insert into stock_counts (counted_at, note, created_by) values ($1, $2, $3) returning id",
        [countedAt, String(req.body?.note ?? "").slice(0, 500) || null, admin.id]
      );
      for (const l of lines) {
        await client.query("insert into stock_count_lines (count_id, item_id, location_id, qty) values ($1, $2, $3, $4)",
          [c.id, l.item_id, l.location_id, l.qty]);
      }
      return c.id;
    });
    return { id };
  });

  // Правити й видаляти можна лише останню (власник: «останню інвентаризацію
  // можна відредагувати заднім числом»); дату — не раніше за попередню.
  async function latestOrFail(id) {
    const count = await one("select * from stock_counts where id = $1", [id]);
    if (!count) fail(404, "no_such_count");
    const latest = await one("select id from stock_counts order by counted_at desc, id desc limit 1");
    if (latest.id !== count.id) fail(409, "not_latest");
    return count;
  }

  app.put("/admin/stock/counts/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const count = await latestOrFail(req.params.id);
    const countedAt = moment(req.body?.counted_at ?? count.counted_at, "counted_at");
    const lines = await countLines(req.body);
    const prev = await one("select counted_at from stock_counts where id <> $1 order by counted_at desc limit 1", [count.id]);
    if (prev && new Date(countedAt) <= new Date(prev.counted_at)) fail(409, "not_after_previous", { previous: prev.counted_at });
    await tx(async (client) => {
      await client.query("update stock_counts set counted_at = $2, note = $3, updated_at = now() where id = $1",
        [count.id, countedAt, String(req.body?.note ?? "").slice(0, 500) || null]);
      await client.query("delete from stock_count_lines where count_id = $1", [count.id]);
      for (const l of lines) {
        await client.query("insert into stock_count_lines (count_id, item_id, location_id, qty) values ($1, $2, $3, $4)",
          [count.id, l.item_id, l.location_id, l.qty]);
      }
    });
    return { id: count.id };
  });

  app.delete("/admin/stock/counts/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const count = await latestOrFail(req.params.id);
    await one("delete from stock_counts where id = $1 returning id", [count.id]);
    return { ok: true };
  });

  // ── закупки ───────────────────────────────────────────────────────────
  app.get("/admin/stock/purchases", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const pg = pageOf(req.query, { per: 20 });
    const purchases = await many(
      `select p.id, p.received_at, p.supplier, p.doc, p.note, p.created_by, p.created_at,
              coalesce(sum(l.cost_uah), 0)::float as total,
              json_agg(json_build_object('id', l.id, 'kind', l.kind, 'item_id', l.item_id, 'item', i.name, 'unit', i.unit,
                                         'category', l.category, 'description', l.description, 'qty', l.qty, 'cost_uah', l.cost_uah)
                       order by l.id) filter (where l.id is not null) as lines
         from stock_purchases p
         left join stock_purchase_lines l on l.purchase_id = p.id
         left join stock_items i on i.id = l.item_id
        group by p.id order by p.received_at desc, p.id desc limit $1 offset $2`,
      [pg.per, pg.offset]
    );
    const totals = await one(
      `select coalesce(sum(cost_uah) filter (where kind = 'material'), 0)::float as material,
              coalesce(sum(cost_uah) filter (where kind = 'capex'), 0)::float as capex,
              coalesce(sum(cost_uah) filter (where kind = 'opex'), 0)::float as opex
         from stock_purchase_lines`
    );
    const count = await one("select count(*)::int as n from stock_purchases");
    return { purchases, totals, page: pageInfo(pg, count.n) };
  });

  app.get("/admin/stock/purchases/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const purchase = await one("select * from stock_purchases where id = $1", [req.params.id]);
    if (!purchase) fail(404, "no_such_purchase");
    const lines = await many(
      `select l.id, l.kind, l.item_id, i.name as item, i.unit, l.category, l.description, l.qty, l.cost_uah
         from stock_purchase_lines l left join stock_items i on i.id = l.item_id
        where l.purchase_id = $1 order by l.id`,
      [purchase.id]
    );
    return { purchase: { ...purchase, lines } };
  });

  app.post("/admin/stock/purchases", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const receivedAt = moment(req.body?.received_at, "received_at");
    const lines = await purchaseLines(req.body);
    const id = await tx(async (client) => {
      const { rows: [p] } = await client.query(
        "insert into stock_purchases (received_at, supplier, doc, note, created_by) values ($1, $2, $3, $4, $5) returning id",
        [receivedAt, String(req.body?.supplier ?? "").trim().slice(0, 120) || null, String(req.body?.doc ?? "").trim().slice(0, 200) || null,
         String(req.body?.note ?? "").trim().slice(0, 500) || null, admin.id]
      );
      await insertPurchaseLines(client, p.id, lines);
      return p.id;
    });
    return { id };
  });

  app.put("/admin/stock/purchases/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const found = await one("select id from stock_purchases where id = $1", [req.params.id]);
    if (!found) fail(404, "no_such_purchase");
    const receivedAt = moment(req.body?.received_at, "received_at");
    const lines = await purchaseLines(req.body);
    await tx(async (client) => {
      await client.query("update stock_purchases set received_at = $2, supplier = $3, doc = $4, note = $5 where id = $1",
        [found.id, receivedAt, String(req.body?.supplier ?? "").trim().slice(0, 120) || null, String(req.body?.doc ?? "").trim().slice(0, 200) || null,
         String(req.body?.note ?? "").trim().slice(0, 500) || null]);
      await client.query("delete from stock_purchase_lines where purchase_id = $1", [found.id]);
      await insertPurchaseLines(client, found.id, lines);
    });
    return { id: found.id };
  });

  app.delete("/admin/stock/purchases/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const row = await one("delete from stock_purchases where id = $1 returning id", [req.params.id]);
    if (!row) fail(404, "no_such_purchase");
    return { ok: true };
  });

  // ── матеріали ─────────────────────────────────────────────────────────
  app.get("/admin/stock/items", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const items = await many(
      `select i.*, i.pack_size::float as pack_size, i.per_day::float as per_day,
              (select (sum(cost_uah) / nullif(sum(qty), 0))::float from stock_purchase_lines where item_id = i.id) as unit_cost,
              (select max(p.received_at) from stock_purchase_lines l join stock_purchases p on p.id = l.purchase_id where l.item_id = i.id) as last_bought,
              exists (select 1 from stock_purchase_lines where item_id = i.id)
                or exists (select 1 from stock_count_lines where item_id = i.id)
                or exists (select 1 from recipe_lines where item_id = i.id) as used
         from stock_items i order by i.sort_order, i.id`
    );
    const locations = await many("select id, name, point_id, kind from stock_locations order by sort_order, id");
    return { items, locations };
  });

  const itemFields = (b, partial) => {
    const out = {};
    if (!partial || b.name !== undefined) {
      const name = String(b.name ?? "").trim();
      if (!name) fail(400, "bad_name");
      out.name = name.slice(0, 120);
    }
    if (!partial || b.kind !== undefined) {
      if (!["ingredient", "packaging", "consumable"].includes(b.kind)) fail(400, "bad_kind");
      out.kind = b.kind;
    }
    if (b.pack_size !== undefined) {
      const v = num(b.pack_size);
      if (v !== null && !(v > 0)) fail(400, "bad_pack_size");
      out.pack_size = v;
    }
    if (b.pack_name !== undefined) out.pack_name = String(b.pack_name ?? "").trim().slice(0, 60) || null;
    if (b.per_day !== undefined) {
      const v = num(b.per_day) ?? 0;
      if (!(v >= 0)) fail(400, "bad_per_day");
      out.per_day = v;
    }
    if (b.canister !== undefined) {
      const v = num(b.canister);
      if (v !== null && !Number.isInteger(v)) fail(400, "bad_canister");
      out.canister = v;
    }
    if (b.sort_order !== undefined) out.sort_order = Number(b.sort_order) || 0;
    if (b.active !== undefined) out.active = Boolean(b.active);
    if (b.note !== undefined) out.note = String(b.note ?? "").trim().slice(0, 500) || null;
    return out;
  };

  app.post("/admin/stock/items", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = String(req.body?.id ?? "").trim();
    if (!/^[a-z0-9_]{2,40}$/.test(id)) fail(400, "bad_id");
    if (!["g", "ml", "pcs"].includes(req.body?.unit)) fail(400, "bad_unit");
    if (await one("select id from stock_items where id = $1", [id])) fail(409, "item_exists");
    const f = itemFields(req.body ?? {}, false);
    const cols = ["id", "unit", ...Object.keys(f)];
    const vals = [id, req.body.unit, ...Object.values(f)];
    await one(`insert into stock_items (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals)
      .catch((e) => { if (e.code === "23505") fail(409, "canister_taken"); throw e; });
    return { id };
  });

  app.patch("/admin/stock/items/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const f = itemFields(req.body ?? {}, true);
    if (!Object.keys(f).length) fail(400, "nothing_to_change");
    const sets = Object.keys(f).map((k, i) => `${k} = $${i + 2}`);
    const row = await one(`update stock_items set ${sets.join(", ")} where id = $1 returning id`, [req.params.id, ...Object.values(f)])
      .catch((e) => { if (e.code === "23505") fail(409, "canister_taken"); throw e; });
    if (!row) fail(404, "no_such_item");
    return { id: row.id };
  });

  // ── рецепти ───────────────────────────────────────────────────────────
  app.get("/admin/stock/recipes", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const versions = await many(
      `select v.id, v.valid_from, v.source, v.note, v.products, v.created_by, v.created_at, count(l.*)::int as lines
         from recipe_versions v left join recipe_lines l on l.version_id = v.id
        group by v.id order by v.valid_from desc`
    );
    const current = await versionAt(new Date().toISOString());
    const id = Number(req.query.version) || current?.id;
    const shown = id === current?.id ? current : await one("select * from recipe_versions where id = $1", [id]);
    const lines = shown
      ? await many("select product_id, item_id, qty::float as qty, take_rate::float as take_rate from recipe_lines where version_id = $1 order by product_id, item_id", [shown.id])
      : [];
    const drinks = await many("select slot::int as product_id, name, cup, active from drinks where slot ~ '^\\d+$' order by sort_order nulls last, slot");
    const items = await many("select id, name, unit, kind, canister from stock_items order by sort_order, id");
    return { versions, current_id: current?.id ?? null, version: shown ? { ...shown, lines } : null, drinks, items };
  });

  // Нова версія з повного набору рядків (правка норм, стакана, кришки).
  app.post("/admin/stock/recipes", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const validFrom = moment(req.body?.valid_from, "valid_from");
    const lines = await recipeLines(req.body?.lines);
    const base = await versionAt(validFrom);
    const id = await createVersion(admin, {
      validFrom, source: "admin", note: String(req.body?.note ?? "").trim().slice(0, 500) || null,
      products: base?.products ?? {}, lines,
    });
    return { id };
  });

  // Імпорт резервної копії рецептів машини: products (*.product) і recipes
  // (*.recipe) — розібрані адмінкою з Recipe_Product_Zip.
  app.post("/admin/stock/recipes/import", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const validFrom = moment(req.body?.valid_from, "valid_from");
    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    const recipes = Array.isArray(req.body?.recipes) ? req.body.recipes : [];
    if (!products.length || !recipes.length) fail(400, "bad_backup");
    const base = await versionAt(validFrom);
    const { lines, names } = await machineLines(products, recipes, base);
    // Що змінилось проти чинної версії — щоб було видно, що саме імпортували.
    const key = (l) => `${l.product_id}|${l.item_id}`;
    const before = new Map((base?.lines ?? []).map((l) => [key(l), l]));
    const after = new Map(lines.map((l) => [key(l), l]));
    const changes = [];
    for (const [k, l] of after) {
      const b = before.get(k);
      if (!b || b.qty !== l.qty || b.take_rate !== l.take_rate) changes.push({ product_id: l.product_id, item_id: l.item_id, before: b?.qty ?? null, after: l.qty });
    }
    for (const [k, b] of before) if (!after.has(k)) changes.push({ product_id: b.product_id, item_id: b.item_id, before: b.qty, after: null });
    if (req.body?.dry_run) return { changes, lines: lines.length, names };
    if (!changes.length) fail(409, "no_changes");
    const id = await createVersion(admin, {
      validFrom, source: "machine", note: String(req.body?.note ?? "").trim().slice(0, 500) || "імпорт резервної копії машини",
      products: { ...(base?.products ?? {}), ...names }, lines,
    });
    return { id, changes };
  });

  // Прибрати версію (помилковий імпорт). Останню-єдину — ні: без рецепта
  // витрату рахувати нічим.
  app.delete("/admin/stock/recipes/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const total = await one("select count(*)::int as n from recipe_versions");
    if (total.n <= 1) fail(409, "last_version");
    const row = await one("delete from recipe_versions where id = $1 returning id", [req.params.id]);
    if (!row) fail(404, "no_such_version");
    await syncUsage(pool);
    return { ok: true };
  });
}
