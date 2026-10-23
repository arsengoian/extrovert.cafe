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
import { portalClient, JetinnoSessionError, ORDER_COL } from "@extrovert/lib/jetinno/portal.js";

// Текст типу оплати з CSV → наш код. Значення теж перекладне, тож тримаємо
// кілька основ, а «безготівку» перевіряємо ПЕРШОЮ: німецьке «bargeldlos»
// містить «bargeld». Нерозпізнане лишаємо як є — його видно в raw.
function payType(text) {
  const s = (text || "").toLowerCase();
  if (s.includes("cashless") || s.includes("bargeldlos") || s.includes("безготів")) return "mdb_cashless";
  if (s.includes("готівк") || s.includes("bargeld") || s.includes("cash")) return "mdb_cash";
  if (s.includes("пробн") || s.includes("test")) return "test";
  return s || null;
}

const kyiv = (v) => (v && v.trim() ? v.trim() : null); // час машини — київський; каст у SQL

// Подія з /error ще висить (портал лишає «скинуто» порожнім або «--»).
const isActive = (f) => !f.cleared || f.cleared === "--" || f.cleared === "";
// «ERROR:5A00 Піддон повний» — рядком, а не об'єктом: так воно однаково
// читабельне і в картці машини, і в спільній таблиці показників.
const brief = (f) => [f.code, f.desc].filter(Boolean).join(" ").slice(0, 80);
// Час машини — київський, без зони; нерозібране віддаємо як 0, тобто «давнє»,
// щоб сміття не лізло в добовий зріз.
const eventAt = (s) => {
  const t = Date.parse(String(s || "").replace(" ", "T"));
  return Number.isFinite(t) ? t : 0;
};

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
    const { header, rows } = await portal.orders(vmc, month);
    for (const r of rows) {
      const orderNo = r[ORDER_COL.orderNo];
      if (!orderNo) continue;
      seen++;
      // raw лишаємо з заголовками тієї мови, якою портал віддав CSV: читаємо
      // все одно за позицією, а підписи рятують, коли щось не зійдеться.
      const raw = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
      await client.query(
        `insert into machine_orders (point_id, order_no, product_id, price_uah, pay_type, status, purchased_at, uploaded_at, raw)
         values ($1, $2, $3, $4, $5, $6,
                 nullif($7,'')::timestamp at time zone 'Europe/Kyiv',
                 nullif($8,'')::timestamp at time zone 'Europe/Kyiv', $9)
         on conflict (point_id, order_no) do update
           set price_uah = excluded.price_uah, pay_type = excluded.pay_type, status = excluded.status`,
        [
          point, orderNo, Number(r[ORDER_COL.productId]) || null, Number(r[ORDER_COL.price]) || null,
          payType(r[ORDER_COL.payType]), r[ORDER_COL.status] || null,
          kyiv(r[ORDER_COL.purchasedAt]), kyiv(r[ORDER_COL.uploadedAt]),
          JSON.stringify(raw),
        ]
      );
    }
  }
  return seen;
}

// Звірка за добу: карткові замовлення машини проти чеків Checkbox. Готівкові
// теж мали б фіскалізуватись (власник, 09.10.2026), тож рахуємо і їх — як
// сигнал, не як норму.
//
// Кожне замовлення шукає свій чек поруч у часі, а не порівнюються два
// лічильники за добу (17.10.2026). Чек пробивається в момент оплати, а
// замовлення машина пише, коли допила напій, — на 30–55 с пізніше. Тож
// через добу чек випадав з вікна раніше за своє замовлення, і проба, що
// влучала в ці секунди, показувала «4 замовлення / 3 чеки» без жодної
// розбіжності (17.10 о 10:32). Тепер обидва списки беруться із запасом
// MATCH_S за межею доби, і пара, яку межа розрізала, однаково сходиться.
//
// Червоне — лише справжнє: карткове замовлення без чека, старше за
// ORDER_GRACE_S (чек приходить раніше за замовлення), або чек без
// замовлення, старший за RECEIPT_GRACE_S (замовлення доходять із порталу,
// який ми опитуємо раз на пів години: затримка до ~30 хв).
const MATCH_S = 10 * 60;
const ORDER_GRACE_S = 10 * 60;
const RECEIPT_GRACE_S = 45 * 60;
async function reconcile(client, point) {
  const { rows: orders } = await client.query(
    `select pay_type, status, extract(epoch from purchased_at)::float8 as t from machine_orders
      where point_id = $1 and pay_type in ('mdb_cashless', 'mdb_cash')
        and purchased_at > now() - interval '24 hours' - make_interval(secs => $2)
      order by purchased_at`,
    [point, MATCH_S]
  );
  const { rows: receipts } = await client.query(
    `select extract(epoch from fiscal_date)::float8 as t from receipts
      where point_id = $1 and fiscal_date > now() - interval '24 hours' - make_interval(secs => $2)
      order by fiscal_date`,
    [point, MATCH_S]
  );
  // Кожному замовленню — найближчий ще вільний чек у межах MATCH_S. Готівкові
  // теж беруть чек: пробитий за готівку чек — не «чек без замовлення».
  const taken = new Set();
  const paired = orders.map((o) => {
    let best = -1;
    receipts.forEach((r, i) => {
      const d = Math.abs(r.t - o.t);
      if (!taken.has(i) && d <= MATCH_S && (best < 0 || d < Math.abs(receipts[best].t - o.t))) best = i;
    });
    if (best >= 0) taken.add(best);
    return best >= 0;
  });
  const now = Date.now() / 1000;
  const inDay = (t) => t > now - 86400;
  const card = orders.filter((o) => o.pay_type === "mdb_cashless" && inDay(o.t));
  const noReceipt = orders.filter((o, i) =>
    o.pay_type === "mdb_cashless" && inDay(o.t) && !paired[i] && now - o.t > ORDER_GRACE_S).length;
  const noOrder = receipts.filter((r, i) => inDay(r.t) && !taken.has(i) && now - r.t > RECEIPT_GRACE_S).length;
  return {
    orders_card_24h: card.length,
    orders_cash_24h: orders.filter((o) => o.pay_type === "mdb_cash" && inDay(o.t)).length,
    receipts_24h: receipts.filter((r) => inDay(r.t)).length,
    card_no_receipt_24h: noReceipt,
    receipts_no_order_24h: noOrder,
    reconcile_ok: noReceipt === 0 && noOrder === 0,
    // Замовлення, які машина позначила «Неуспішно», — напій не видано
    // (22.10.2026: лате без води). Чи повернули гроші, стежить overseer
    // (checkFailedOrders); тут — лише скільки їх за добу.
    orders_failed_24h: orders.filter((o) => o.status && o.status !== "Успішно" && inDay(o.t)).length,
  };
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
    // Журнал несправностей тягнемо ЗАВЖДИ, а не лише коли get_device показав
    // лічильник. 11.10.2026: на машині були відчинені дверцята, повний піддон
    // і MDB offline, а error_count/warning_count віддавали 0 — через цей гейт
    // у телеметрію не потрапляло взагалі нічого. Крім активних беремо й ті,
    // що піднялись і згасли між проходами: опитування рідке (раз на 30 хв),
    // інакше короткі події (ті самі дверцята) видно лише на самій машині.
    const all = await portal.faults(vmc);
    const active = all.filter(isActive);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = all.filter((f) => !isActive(f) && eventAt(f.raised) >= since);
    metrics.fault_codes = active.map(brief).slice(0, 20);
    if (recent.length) metrics.faults_recent_24h = recent.map(brief).slice(0, 20);
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
