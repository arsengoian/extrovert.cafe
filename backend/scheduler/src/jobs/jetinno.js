// Телеметрія кавомашини з порталу Jetinno — рідша за малину, окремою
// категорією (docs/jetinno.md, «Телеметрія кавомашини»). Раз на
// JETINNO_TELEMETRY_MIN хвилин (типово 30): стан машини, несправності,
// залишки, і звірка замовлень машини з чеками Checkbox. Заразом знімаємо
// замовлення машини в machine_orders — наш журнал продажів це receipts, а тут
// те, що звітує сама машина, щоб бачити розбіжності.
//
// Пише в device_telemetry з source='jetinno' (одна проба на прохід). Сесії
// немає / портал лежить — не падаємо: лишаємо пробу з session:false, щоб
// адмінка показала «потрібен вхід», і йдемо далі.
import { portalClient, JetinnoSessionError } from "@extrovert/lib/jetinno/portal.js";

// Текст типу оплати з CSV → наш код. Інше лишаємо як є (побачимо в raw).
function payType(text) {
  const s = (text || "").toLowerCase();
  if (s.includes("cashless")) return "mdb_cashless";
  if (s.includes("готівк") || s.includes("cash")) return "mdb_cash";
  if (s.includes("пробн") || s.includes("test")) return "test";
  return s || null;
}

const kyiv = (v) => (v && v.trim() ? v.trim() : null); // час машини — київський; каст у SQL

// Замовлення машини за місяць → machine_orders (upsert за order_no).
async function syncOrders(client, portal, point, vmc) {
  const now = new Date();
  const months = [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`];
  // На початку місяця захопимо й попередній, щоб не губити межу доби.
  if (now.getDate() <= 1) {
    const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    months.push(`${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`);
  }
  let seen = 0;
  for (const month of months) {
    const rows = await portal.orders(vmc, month);
    for (const r of rows) {
      const orderNo = r["Номер замовлення"];
      if (!orderNo) continue;
      seen++;
      await client.query(
        `insert into machine_orders (point_id, order_no, product_id, price_uah, pay_type, status, purchased_at, uploaded_at, raw)
         values ($1, $2, $3, $4, $5, $6,
                 nullif($7,'')::timestamp at time zone 'Europe/Kyiv',
                 nullif($8,'')::timestamp at time zone 'Europe/Kyiv', $9)
         on conflict (point_id, order_no) do update
           set price_uah = excluded.price_uah, pay_type = excluded.pay_type, status = excluded.status`,
        [
          point, orderNo, Number(r["Код напою"]) || null, Number(r["Ціна напою"]) || null,
          payType(r["Тип оплати"]), r["Стан"] || null, kyiv(r["Час покупки"]), kyiv(r["Час завантаження"]),
          JSON.stringify(r),
        ]
      );
    }
  }
  return seen;
}

// Звірка за добу: карткові замовлення машини проти чеків Checkbox. Готівкові
// теж мали б фіскалізуватись (власник, 09.10.2026), тож рахуємо і їх — як
// сигнал, не як норму.
async function reconcile(client, point) {
  const { rows } = await client.query(
    `select
       (select count(*) from machine_orders
         where point_id = $1 and pay_type = 'mdb_cashless' and purchased_at > now() - interval '24 hours')::int as card,
       (select count(*) from machine_orders
         where point_id = $1 and pay_type = 'mdb_cash' and purchased_at > now() - interval '24 hours')::int as cash,
       (select count(*) from receipts
         where point_id = $1 and fiscal_date > now() - interval '24 hours')::int as receipts`,
    [point]
  );
  const { card, cash, receipts } = rows[0];
  return { orders_card_24h: card, orders_cash_24h: cash, receipts_24h: receipts, reconcile_ok: card === receipts };
}

async function pollPoint(client, redis, point, vmc, log) {
  const portal = portalClient({ redis });
  const metrics = { session: true };
  try {
    const dev = await portal.device(vmc);
    if (!dev) { metrics.session = true; metrics.online = false; metrics.note = "машини немає в акаунті"; }
    else {
      metrics.online = Boolean(dev.is_connected);
      metrics.last_login = dev.last_login ?? null;
      metrics.faults = Number(dev.error_count) || 0;
      metrics.warnings = Number(dev.warning_count) || 0;
      metrics.supply_short = Number(dev.supply_count) || 0;
    }
    if (metrics.faults) {
      const active = (await portal.faults(vmc)).filter((f) => !f.cleared || f.cleared === "--" || f.cleared === "");
      metrics.fault_codes = active.map((f) => f.code).slice(0, 20);
    }
    await syncOrders(client, portal, point, vmc);
    Object.assign(metrics, await reconcile(client, point));
  } catch (e) {
    if (e instanceof JetinnoSessionError) { metrics.session = false; log?.info(`Jetinno ${point}: немає сесії`); }
    else throw e;
  }

  const measuredAt = new Date();
  const bucket = Math.floor(measuredAt.getTime() / 60_000);  // хвилина — досить для idem
  await client.query(
    `insert into device_telemetry (point_id, source, idem_key, measured_at, metrics, received_at)
     values ($1, 'jetinno', $2, $3, $4, now())
     on conflict (idem_key) do update set metrics = excluded.metrics`,
    [point, `jetinno:${point}:${bucket}`, measuredAt, JSON.stringify(metrics)]
  );
  return metrics;
}

export async function pollJetinno({ pool, redis, log }) {
  const { rows: points } = await pool.query("select id, jetinno_vmc from points where jetinno_vmc is not null order by id");
  if (!points.length) return null;
  const client = await pool.connect();
  let ok = 0, offline = 0, noSession = 0;
  try {
    for (const p of points) {
      try {
        const m = await pollPoint(client, redis, p.id, p.jetinno_vmc, log);
        if (m.session === false) noSession++;
        else if (m.online) ok++; else offline++;
      } catch (e) {
        log?.error(`телеметрія Jetinno ${p.id} не знялась`, e);
      }
    }
  } finally {
    client.release();
  }
  return { done: `Jetinno: онлайн ${ok}, офлайн ${offline}${noSession ? `, без сесії ${noSession}` : ""}` };
}
