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
import { presign } from "@extrovert/lib/r2.js";
import { enqueue } from "@extrovert/lib/outbox.js";

const product = (id) => shopProducts.products.find((p) => p.id === id) ?? null;
// У замовленнях — коротко й з розміром: «Футболка, M» (кадр «Мої замовлення»).
const orderName = (id, options) => {
  const p = product(id);
  const base = p?.short ?? p?.name ?? id;
  return options?.size ? `${base}, ${options.size}` : base;
};
const priceOf = (id) => economy.shop_beans[id]?.beans ?? null;

// ── принт ───────────────────────────────────────────────────────────────
// Товар із зоною друку (чашка, футболка) друкується з кавенятка, яке обрав
// гравець (власник, 01.10.2026). PNG малює застосунок — у нього вже є сцена
// й спрайти — і заливає сам за підписаним посиланням у приватний бакет
// uploads: це те, що надсилає гравець і читає адмінка, як і фото зі скарг.
const printed = (p) => Boolean(p?.print_area_mm);
const printKey = (id) => `prints/${id}.png`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Без R2 (локально без MinIO) посилань немає — замовлення від цього не падає.
const link = (opts) => {
  try { return presign({ purpose: "uploads", ...opts }).url; } catch { return null; }
};
const printUpload = (id) => link({ method: "PUT", key: printKey(id), contentType: "image/png", expiresIn: 900 });

// Посилання на готовий принт: подивитись і завантажити файлом.
export function printLinks(row) {
  if (!row?.print_r2_key) return null;
  return {
    url: link({ method: "GET", key: row.print_r2_key, expiresIn: 3600 }),
    download_url: link({ method: "GET", key: row.print_r2_key, expiresIn: 3600, filename: `принт-${row.id}.png` }),
  };
}

const printView = (row) => (row.print_snapshot
  ? {
      snapshot: row.print_snapshot,
      ...(printLinks(row) ?? {}),
      // Файл не доїхав (обірвався звʼязок одразу після оплати) — застосунок
      // домалює його з того самого знімка, поки замовлення ще не в друці.
      upload_url: !row.print_r2_key && row.status === "new" ? printUpload(row.id) : null,
    }
  : null);

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
    // Будь-яка країна, не лише +380 (власник, 01.10.2026): E.164 — «+», код
    // країни й номер, разом від 8 до 15 цифр.
    if (!/^\+?\d{8,15}$/.test(phone)) fail(400, "bad_phone");
    if (!warehouseRef) fail(400, "warehouse_required");
    if (p.options?.size && !p.options.size.includes(options.size)) fail(400, "size_required");

    // Знімок обраного кавенятка: друкуємо таким, яким воно було зараз, а не
    // яким стане (кущ росте, переодягається, може піти на ринок).
    let snapshot = null;
    if (printed(p)) {
      const plantId = String(req.body?.print_plant_id ?? "");
      const plant = UUID.test(plantId)
        ? await one("select id, name, growth_stage, face_set_id, appearance, worn_set_id from plants where id = $1 and owner_id = $2", [plantId, user.id])
        : null;
      if (!plant) fail(400, "plant_required");
      const worn = plant.worn_set_id
        ? await many(
            `select wsi.slot, d.code, d.sprite_id from wardrobe_set_items wsi
               join user_items ui on ui.id = wsi.user_item_id
               join item_defs d on d.id = ui.item_def_id
              where wsi.set_id = $1`,
            [plant.worn_set_id]
          )
        : [];
      const { draft: _draft, ...appearance } = plant.appearance ?? {};   // чернетку посадки не друкуємо
      snapshot = { plant_id: plant.id, name: plant.name, growth_stage: plant.growth_stage, face_set_id: plant.face_set_id,
                   appearance, worn, taken_at: new Date().toISOString() };
    }

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
            np_warehouse_ref, np_warehouse_kind, np_address_snapshot, print_plant_id, print_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, status, created_at`,
        [user.id, entry[0].id, id, options, name, phone, warehouse.ref, warehouse.category, address,
         snapshot?.plant_id ?? null, snapshot]
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

      // Замовлення — одразу власнику в Telegram, з усім, що треба, щоб його
      // зібрати й відправити (власник, 02.10.2026). Подія йде в канал admin
      // тією самою транзакцією; її слухає overseer, як і скарги.
      const { rows: who } = await client.query("select nickname from users where id = $1", [user.id]);
      await enqueue(client, "admin", "order_created", {
        order_id: Number(rows[0].id),
        product: p.name,
        options,
        beans: price,
        nickname: who[0]?.nickname ?? null,
        recipient_name: name,
        recipient_phone: phone,
        address,
        kind: warehouse.category,
        print: snapshot ? { plant: snapshot.name, stage: snapshot.growth_stage } : null,
      });

      return { ok: true, id: rows[0].id, status: rows[0].status, address, spent_beans: price,
               print_upload_url: snapshot ? printUpload(rows[0].id) : null };
    });
  });

  // Залитий принт: перевіряємо, що файл справді в бакеті, і лише тоді
  // записуємо ключ — інакше замовлення показувало б посилання в нікуди.
  app.post("/me/redemptions/:id/print", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!/^\d+$/.test(String(req.params.id))) fail(404, "no_such_order");
    const row = await one("select id, print_snapshot from redemptions where id = $1 and user_id = $2", [req.params.id, user.id]);
    if (!row?.print_snapshot) fail(404, "no_print");
    const head = link({ method: "HEAD", key: printKey(row.id), expiresIn: 60 });
    const res = head ? await fetch(head, { method: "HEAD" }).catch(() => null) : null;
    if (!res?.ok) fail(409, "not_uploaded");
    await tx(async (client) => {
      const { rows: done } = await client.query(
        "update redemptions set print_r2_key = $2 where id = $1 and print_r2_key is null returning id",
        [row.id, printKey(row.id)]
      );
      // Файл для друкарні — слідом за повідомленням про замовлення, лише раз.
      if (done.length) {
        await enqueue(client, "admin", "order_print_ready", {
          order_id: Number(row.id), plant: row.print_snapshot?.name ?? null, key: printKey(row.id),
        });
      }
    });
    return { ok: true };
  });

  // Дані попереднього замовлення — щоб друге не заповнювати з нуля
  // (власник, 01.10.2026). Відділення — лише якщо воно досі працює.
  app.get("/me/redemptions/last", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one(
      `select r.recipient_name, r.recipient_phone, r.np_warehouse_kind,
              w.ref, w.number, w.category, w.description, w.short_address, w.schedule,
              c.ref as city_ref, c.name as city_name, c.area as city_area
         from redemptions r
         left join np_warehouses w on w.ref = r.np_warehouse_ref and (w.status is null or w.status = 'Working')
         left join np_cities c on c.ref = w.city_ref
        where r.user_id = $1 order by r.created_at desc limit 1`,
      [user.id]
    );
    if (!row) return { last: null };
    const [first, ...rest] = row.recipient_name.trim().split(/\s+/);
    return {
      last: {
        first,
        last: rest.join(" "),
        phone: row.recipient_phone,
        kind: row.category ?? row.np_warehouse_kind ?? "branch",
        city: row.city_ref ? { ref: row.city_ref, name: row.city_name, area: row.city_area } : null,
        warehouse: row.ref
          ? { ref: row.ref, number: row.number, category: row.category, description: row.description, address: row.short_address, schedule: row.schedule }
          : null,
      },
    };
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
      print: printView(row),
      events: events.map((e) => ({ ...e, label: STATUS_LABEL[e.status] ?? e.status })),
    };
  });
}
