// Доставка Новою Поштою: пошук міста й відділення, оформлення замовлення
// за зерна, «Мої замовлення».
//
// Пошук іде по локальній копії довідника (np_cities / np_warehouses), а не
// в API НП: чекаут не має лягати разом із чужим сервісом, і ключ НП не має
// потрапляти в браузер (services.md §4). Копію оновлює scheduler раз на добу.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy, shopProducts } from "../economy.js";
import { notifyPlant } from "../notify.js";

const product = (id) => shopProducts.products.find((p) => p.id === id) ?? null;
// У замовленнях — коротко й з розміром: «Футболка, M» (кадр «Мої замовлення»).
const orderName = (id, options) => {
  const p = product(id);
  const base = p?.short ?? p?.name ?? id;
  return options?.size ? `${base}, ${options.size}` : base;
};
const priceOf = (id) => economy.shop_beans[id]?.beans ?? null;

// Назви статусів — як у кадрах «Мої замовлення».
export const STATUS_LABEL = {
  new: "Нове",
  printing: "Друкуємо",
  packing: "Пакуємо",
  shipped: "Відправлено",
  arrived: "Прибуло у відділення",
  received: "Отримано",
  returned: "Повернуто",
  cancelled: "Скасовано",
};

// «Київ, відділення №12» — коротке місце для списку й картки. Беремо з
// довідника за ref; якщо відділення з довідника зникло — знімок адреси.
const KIND_WORD = { branch: "відділення", postomat: "поштомат" };
const placeOf = (r) => (r.wh_number && r.city_name
  ? `${r.city_name}, ${KIND_WORD[r.np_warehouse_kind] ?? "відділення"} №${r.wh_number}`
  : r.np_address_snapshot);
const ORDER_SELECT = `select r.*, w.number as wh_number, c.name as city_name, -le.delta_beans as beans
     from redemptions r
     left join np_warehouses w on w.ref = r.np_warehouse_ref
     left join np_cities c on c.ref = w.city_ref
     left join ledger_entries le on le.id = r.ledger_entry_id`;

// Поштомат має фізичну межу за габаритами й вагою — товар, який у неї не
// влазить, туди просто не приймуть. Межі в довіднику бувають порожні:
// тоді поштомат ховаємо (краще недопоказати, ніж зірвати доставку).
function fitsPostomat(warehouse, packed) {
  if (!packed) return true;
  const limits = warehouse.dimension_limits ?? null;
  const maxWeight = warehouse.place_max_weight_kg ?? null;
  if (maxWeight !== null && packed.weight_kg > maxWeight) return false;
  if (!limits) return false;
  const box = [packed.length_cm, packed.width_cm, packed.height_cm].sort((a, b) => b - a);
  const cell = [limits.length_cm, limits.width_cm, limits.height_cm].filter((v) => v > 0).sort((a, b) => b - a);
  if (cell.length < 3) return false;
  return box.every((side, i) => side <= cell[i]);
}

export default async function routes(app) {
  app.get("/np/cities", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const q = String(req.query?.q ?? "").trim();
    // Без запиту — міста з найбільшою кількістю відділень: шторка вибору
    // міста в макеті одразу показує список, а не порожнє поле.
    if (q.length < 2) {
      const popular = await many(
        `select c.ref, c.name, c.area, c.settlement_type
           from np_cities c left join np_warehouses w on w.city_ref = c.ref
          group by c.ref order by count(w.ref) desc, c.name limit 6`
      );
      return { cities: popular };
    }
    const cities = await many(
      `select ref, name, area, settlement_type from np_cities
        where name ilike $1 order by (name ilike $2) desc, length(name), name limit 20`,
      [`%${q}%`, `${q}%`]
    );
    return { cities };
  });

  app.get("/np/warehouses", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const city = String(req.query?.city ?? "");
    if (!city) fail(400, "city_required");
    const q = String(req.query?.q ?? "").trim();
    const packed = product(String(req.query?.product ?? ""))?.packed ?? null;

    const rows = await many(
      `select * from np_warehouses
        where city_ref = $1 and (status is null or status = 'Working')
          and ($2 = '' or description ilike $3 or short_address ilike $3 or number::text = $2)
        order by category, number limit 60`,
      [city, q, `%${q}%`]
    );

    return {
      warehouses: rows
        .filter((w) => w.category !== "postomat" || fitsPostomat(w, packed))
        .map((w) => ({
          ref: w.ref, number: w.number, category: w.category,
          description: w.description, address: w.short_address, schedule: w.schedule,
        })),
      // Скільки поштоматів сховав фільтр габаритів — щоб гравець не шукав
      // той, який «був учора».
      hidden_postomats: rows.filter((w) => w.category === "postomat" && !fitsPostomat(w, packed)).length,
    };
  });

  app.get("/shop/products/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const p = product(String(req.params.id));
    if (!p) fail(404, "no_such_product");
    return { ...p, price_beans: priceOf(p.id) };
  });

  // Оформлення: зерна списуються тут і тільки тут. Адресу зберігаємо
  // текстом (np_address_snapshot): довідник оновлюється щодоби, а замовлення
  // має лишитись таким, яким його зробили.
  app.post("/me/redemptions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const id = String(req.body?.product ?? "");
    const p = product(id);
    const price = priceOf(id);
    if (!p || !price) fail(404, "no_such_product");

    const name = String(req.body?.recipient_name ?? "").trim();
    const phone = String(req.body?.recipient_phone ?? "").replace(/[^\d+]/g, "");
    const warehouseRef = String(req.body?.warehouse_ref ?? "");
    const options = req.body?.options ?? {};
    if (name.length < 3) fail(400, "bad_name");
    if (!/^\+?\d{10,13}$/.test(phone)) fail(400, "bad_phone");
    if (!warehouseRef) fail(400, "warehouse_required");
    if (p.options?.size && !p.options.size.includes(options.size)) fail(400, "size_required");

    const warehouse = await one(
      `select w.*, c.name as city_name from np_warehouses w
         join np_cities c on c.ref = w.city_ref where w.ref = $1`,
      [warehouseRef]
    );
    if (!warehouse) fail(404, "no_such_warehouse");

    return tx(async (client) => {
      const { rows: paid } = await client.query(
        "update users set beans = beans - $2 where id = $1 and beans >= $2 returning beans",
        [user.id, price]
      );
      if (!paid.length) fail(409, "not_enough", { currency: "beans", need: price });

      const { rows: entry } = await client.query(
        `insert into ledger_entries (user_id, delta_beans, reason, meta)
         values ($1, $2, 'delivery', $3) returning id`,
        [user.id, -price, { product: id, options }]
      );

      const address = `${warehouse.city_name}, ${warehouse.description ?? warehouse.short_address ?? warehouse.ref}`;
      const { rows } = await client.query(
        `insert into redemptions
           (user_id, ledger_entry_id, product, options, recipient_name, recipient_phone,
            np_warehouse_ref, np_warehouse_kind, np_address_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, status, created_at`,
        [user.id, entry[0].id, id, options, name, phone, warehouse.ref, warehouse.category, address]
      );
      await client.query(
        "update ledger_entries set ref_type = 'redemption', ref_id = $2 where id = $1",
        [entry[0].id, rows[0].id]
      );
      await client.query(
        "insert into redemption_events (redemption_id, status, source) values ($1, 'new', 'system')",
        [rows[0].id]
      );
      await notifyPlant(user.id, `Замовлення прийнято: ${p.name} → ${address}.`, { client });

      return { ok: true, id: rows[0].id, status: rows[0].status, address, spent_beans: price };
    });
  });

  app.get("/me/redemptions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(`${ORDER_SELECT} where r.user_id = $1 order by r.created_at desc limit 50`, [user.id]);
    return {
      orders: rows.map((r) => ({
        id: r.id,
        product: r.product,
        name: orderName(r.product, r.options),
        options: r.options,
        status: r.status,
        status_label: STATUS_LABEL[r.status] ?? r.status,
        status_changed_at: r.status_changed_at,
        place: placeOf(r),
        kind: r.np_warehouse_kind,
        beans: r.beans,
        address: r.np_address_snapshot,
        ttn: r.np_ttn,
        unseen: !r.user_seen_at || new Date(r.user_seen_at) < new Date(r.status_changed_at),
        created_at: r.created_at,
      })),
    };
  });

  app.get("/me/redemptions/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one(`${ORDER_SELECT} where r.id = $1 and r.user_id = $2`, [req.params.id, user.id]);
    if (!row) fail(404, "no_such_order");
    const events = await many(
      "select status, source, created_at from redemption_events where redemption_id = $1 order by created_at",
      [row.id]
    );
    // Відкрив картку — значить, побачив статус: лічильник непереглянутих
    // змін живе саме на цьому полі.
    await one("update redemptions set user_seen_at = now() where id = $1 returning id", [row.id]);
    return {
      id: row.id,
      product: row.product,
      name: orderName(row.product, row.options),
      options: row.options,
      status: row.status,
      status_label: STATUS_LABEL[row.status] ?? row.status,
      place: placeOf(row),
      kind: row.np_warehouse_kind,
      beans: row.beans,
      address: row.np_address_snapshot,
      recipient: { name: row.recipient_name, phone: row.recipient_phone },
      ttn: row.np_ttn,
      created_at: row.created_at,
      events: events.map((e) => ({ ...e, label: STATUS_LABEL[e.status] ?? e.status })),
    };
  });
}
