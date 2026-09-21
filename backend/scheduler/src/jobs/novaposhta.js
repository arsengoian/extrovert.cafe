// Нова Пошта: нічний довідник міст і відділень + погодинний трекінг
// відправлень (services.md §4).
//
// Довідник тримаємо локальною копією — так і радить документація НП, і так
// чекаут не лягає разом із їхнім API, а ключ не потрапляє в браузер.
// Без NP_API_KEY обидві роботи мовчки нічого не роблять: локально ключа
// зазвичай немає, а сервіс має підніматись і без нього.
import { readCursor, writeCursor } from "@extrovert/lib/jobs.js";

const API = "https://api.novaposhta.ua/v2.0/json/";
const PAGE = 500;                          // НП більше за раз не віддає
const DIRECTORY_MAX_AGE_H = 20;            // «раз на добу» з запасом на зсув запусків

// Статуси НП → наші. Коди з документації: 7 «прибув у відділення»,
// 9/10/11 «отримано», 102/103 «відмова/повернення».
const STATUS_BY_CODE = {
  7: "arrived", 8: "arrived", 9: "received", 10: "received", 11: "received",
  102: "returned", 103: "returned", 104: "returned",
};

async function call(model, method, properties = {}) {
  const key = process.env.NP_API_KEY;
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: key, modelName: model, calledMethod: method, methodProperties: properties }),
  });
  if (!res.ok) throw new Error(`НП ${model}/${method}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`НП ${model}/${method}: ${(data.errors ?? []).join("; ")}`);
  return data.data ?? [];
}

const hasKey = () => Boolean(process.env.NP_API_KEY);

export async function syncDirectory({ pool, log }) {
  if (!hasKey()) return {};
  const cursor = await readCursor(pool, "np-directory");
  const ageH = cursor?.run_at ? (Date.now() - new Date(cursor.run_at).getTime()) / 3_600_000 : Infinity;
  if (ageH < DIRECTORY_MAX_AGE_H) return {};

  try {
    // Типи відділень: ref поштомата беремо звідси, а не хардкодимо — НП
    // свої ref-и колись міняла.
    const types = await call("Address", "getWarehouseTypes");
    const postomatRefs = new Set(
      types.filter((t) => /поштомат|postomat/i.test(t.Description ?? "")).map((t) => t.Ref)
    );

    const cities = await call("Address", "getCities");
    for (const c of cities) {
      await pool.query(
        `insert into np_cities (ref, name, area, settlement_type, synced_at)
         values ($1, $2, $3, $4, now())
         on conflict (ref) do update
           set name = excluded.name, area = excluded.area,
               settlement_type = excluded.settlement_type, synced_at = now()`,
        [c.Ref, c.Description, c.AreaDescription ?? null, c.SettlementTypeDescription ?? null]
      );
    }

    let page = 1;
    let saved = 0;
    for (;;) {
      const batch = await call("Address", "getWarehouses", { Page: String(page), Limit: String(PAGE) });
      if (!batch.length) break;
      for (const w of batch) {
        const limits = {
          length_cm: Number(w.ReceivingLimitationsOnDimensions?.Length ?? 0),
          width_cm: Number(w.ReceivingLimitationsOnDimensions?.Width ?? 0),
          height_cm: Number(w.ReceivingLimitationsOnDimensions?.Height ?? 0),
        };
        await pool.query(
          `insert into np_warehouses (ref, city_ref, number, category, type_ref, description,
                                      short_address, place_max_weight_kg, dimension_limits, schedule, status, synced_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           on conflict (ref) do update
             set city_ref = excluded.city_ref, number = excluded.number, category = excluded.category,
                 type_ref = excluded.type_ref, description = excluded.description,
                 short_address = excluded.short_address, place_max_weight_kg = excluded.place_max_weight_kg,
                 dimension_limits = excluded.dimension_limits, schedule = excluded.schedule,
                 status = excluded.status, synced_at = now()`,
          [
            w.Ref, w.CityRef, Number(w.Number) || null,
            postomatRefs.has(w.TypeOfWarehouse) ? "postomat" : "branch",
            w.TypeOfWarehouse ?? null, w.Description ?? null, w.ShortAddress ?? null,
            Number(w.PlaceMaxWeightAllowed) || null, limits, w.Schedule ?? null,
            w.WarehouseStatus ?? null,
          ]
        );
        saved += 1;
      }
      if (batch.length < PAGE) break;
      page += 1;
    }

    await writeCursor(pool, "np-directory", { cursorAt: new Date() });
    return { done: `довідник НП оновлено`, extra: { cities: cities.length, warehouses: saved } };
  } catch (e) {
    log?.error("довідник НП не оновився", e);
    await writeCursor(pool, "np-directory", { error: e.message });
    return {};
  }
}

// Трекінг: питаємо лише активні відправлення — ті, що мають ТТН і ще не
// доїхали. Завершені більше не турбуємо, інакше з часом кожна година
// коштувала б запиту на весь архів.
export async function trackShipments({ pool, log }) {
  if (!hasKey()) return {};
  const { rows } = await pool.query(
    `select id, np_ttn, recipient_phone, status from redemptions
      where np_ttn is not null and status not in ('received', 'returned', 'cancelled')
      order by status_changed_at limit 100`
  );
  if (!rows.length) return {};

  try {
    const documents = rows.map((r) => ({ DocumentNumber: r.np_ttn, Phone: r.recipient_phone }));
    const data = await call("TrackingDocument", "getStatusDocuments", { Documents: documents });

    let moved = 0;
    for (const item of data) {
      const row = rows.find((r) => r.np_ttn === item.Number);
      if (!row) continue;
      const next = STATUS_BY_CODE[Number(item.StatusCode)];
      if (!next || next === row.status) continue;

      // Статус і подія — однією транзакцією: історія в картці замовлення не
      // має розходитись зі станом.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "update redemptions set status = $2, status_changed_at = now(), np_status_code = $3 where id = $1",
          [row.id, next, String(item.StatusCode)]
        );
        await client.query(
          "insert into redemption_events (redemption_id, status, source, note) values ($1, $2, 'np', $3)",
          [row.id, next, item.Status ?? null]
        );
        await client.query(
          `insert into outbox (channel, event, payload)
           select 'user:' || user_id, 'order_status', jsonb_build_object('redemption_id', $1, 'status', $2)
             from redemptions where id = $1`,
          [row.id, next]
        );
        await client.query(
          `insert into chat_messages (plant_id, user_id, role, body)
           select p.id, r.user_id, 'system', $2
             from redemptions r
             join plants p on p.owner_id = r.user_id
            where r.id = $1
            order by p.created_at limit 1`,
          [row.id, `Замовлення: ${item.Status ?? next}.`]
        );
        await client.query("commit");
        moved += 1;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        log?.error("статус замовлення не оновився", e);
      } finally {
        client.release();
      }
    }
    await writeCursor(pool, "np-tracking", { cursorAt: new Date() });
    return moved ? { done: `статусів оновлено: ${moved}` } : {};
  } catch (e) {
    log?.error("трекінг НП не відповів", e);
    await writeCursor(pool, "np-tracking", { error: e.message });
    return {};
  }
}
