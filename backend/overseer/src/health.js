// Проби здоровʼя для дашборда адмінки (docs/admin_panel.md, «Дашборд
// здоровʼя»).
//
// Пишемо не кожну пробу, а **півгодинні відра** — так і задумано в схемі
// (`health_samples`, unique (target, bucket_start)): за тиждень це 336
// рядків на ціль, і графік малюється одним запитом. Відро «зелене» лише
// тоді, коли зелені всі проби в ньому: аварію на три хвилини видно, а не
// згладжено середнім. Історія старша за тиждень затирається тут же.
//
// Overseer, а не api: перевірка — це фонова робота, і робити її в процесі,
// який відповідає гравцям, означає ділити з ними таймаути.
import { presign } from "@extrovert/lib/r2.js";
import { checkWebhook, silenceLimit } from "./checks.js";

const TIMEOUT_MS = 8000;
const KEEP_DAYS = 7;

// Сервіси: за іменами в мережі compose, бо overseer живе поруч. Caddy
// перевіряємо ззовні, справжньою адресою — так проба заразом каже, що живі
// й DNS, і сертифікат.
const SERVICES = [
  ["api", "http://api:3001/healthz"],
  ["ws", "http://ws:3002/healthz"],
  ["checkbox", "http://checkbox:3003/healthz"],
  ["caddy", `${process.env.API_ORIGIN || "https://api.extrovert.cafe"}/healthz`],
];

const FRONTENDS = [
  ["front-client", process.env.APP_ORIGIN || "https://extrovert.cafe"],
  ["front-admin", "https://admin.extrovert.cafe"],
  ["front-qr", "https://qr.extrovert.cafe"],
  ["front-redirect", "https://r.extrovert.cafe"],
];

async function probe(url) {
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    // Затримка — лише для відповідей, що дійшли: час до помилки чи таймауту
    // нічого не каже про швидкість сервіса, зате псує середнє.
    const ms = Math.round(performance.now() - started);
    // 3xx для фронтендів — нормальна відповідь (воркер qr тільки так і
    // відповідає), тому «живий» — це будь-яка відповідь, крім 5xx.
    return res.status < 500 ? { ok: true, ms } : { ok: false, ms, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e.name === "TimeoutError" ? `не відповів за ${TIMEOUT_MS / 1000} с` : e.message.slice(0, 120) };
  }
}

async function components(pool, redis) {
  const out = [];

  // Публікатор outbox: черга не має накопичуватись. Дві хвилини — це вже
  // «щось стоїть», бо scheduler забирає її двічі на секунду.
  const { rows: [outbox] } = await pool.query(
    `select count(*)::int as stuck from outbox
      where published_at is null and created_at < now() - interval '2 minutes'`
  );
  out.push(["outbox", outbox.stuck === 0, outbox.stuck ? `${outbox.stuck} подій не опубліковано` : null]);

  // Деплой меню: провалений деплоймент означає, що на точці стара ціна.
  const { rows: [deploy] } = await pool.query(
    `select count(*)::int as failed from menu_deployments
      where status = 'failed' and created_at > now() - interval '1 day'`
  );
  out.push(["menu-deploy", deploy.failed === 0, deploy.failed ? `${deploy.failed} невдалих за добу` : null]);

  // Вебхук ПРРО: сам Checkbox розповідає про свої помилки доставки.
  //
  // «unknown» — це «не змогли спитати», і червоним воно світитись не має:
  // те, що справді важить — чи доходять чеки, — нижче окремим рядком
  // (receipts). Інакше дашборд стояв би червоним через те, що Checkbox не
  // віддає налаштувань, поки чеки спокійно йдуть.
  const webhook = await checkWebhook();
  if (webhook) {
    out.push(["checkbox-webhook", webhook.state === "ok" || webhook.state === "unknown",
      webhook.state === "ok" ? null : webhook.message]);
  }

  // Бекап бази: файл за сьогодні або вчора має лежати в R2.
  out.push(await backupFresh());

  // Чеки: якщо ПРРО живий, а чеків немає добу — це або вихідний, або
  // зламаний ланцюжок. Позначаємо як попередження, деталі в тултіпі.
  const { rows: [receipts] } = await pool.query(
    "select max(fiscal_date) as last from receipts"
  );
  const hours = receipts.last ? (Date.now() - new Date(receipts.last).getTime()) / 3600_000 : null;
  out.push(["receipts", hours !== null && hours < 24, receipts.last ? `останній чек ${hours.toFixed(1)} год тому` : "чеків ще не було"]);

  return out;
}

async function backupFresh() {
  const day = (offset) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
  for (const key of [`postgres/${day(0)}.dump`, `postgres/${day(1)}.dump`]) {
    try {
      const { url } = presign({ method: "HEAD", purpose: "backups", key, expiresIn: 60 });
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return ["backup", true, `останній дамп: ${key.slice(9)}`];
    } catch {
      return ["backup", false, "R2 не відповідає"];
    }
  }
  return ["backup", false, "немає дампа за сьогодні й учора"];
}

export async function sampleHealth({ pool, redis, log }) {
  const targets = [];

  for (const [name, url] of [...SERVICES, ...FRONTENDS]) {
    const r = await probe(url);
    targets.push([name, r.ok, r.detail ?? null, r.ms ?? null]);
  }

  // Scheduler і overseer портів не мають: живий той, хто нещодавно лишив
  // по собі позначку в Redis (lib/jobs.js heartbeat).
  for (const name of ["scheduler", "overseer"]) {
    const beat = await redis.get(`hb:${name}`);
    targets.push([name, Boolean(beat), beat ? null : "немає ознак життя останні дві хвилини"]);
  }

  try {
    await pool.query("select 1");
    targets.push(["postgres", true, null]);
  } catch (e) {
    targets.push(["postgres", false, e.message.slice(0, 120)]);
  }
  try {
    await redis.ping();
    targets.push(["redis", true, null]);
  } catch (e) {
    targets.push(["redis", false, e.message.slice(0, 120)]);
  }

  targets.push(...(await components(pool, redis)));

  // Точки: кожна окремою ціллю, щоб у таблиці POS було видно саме ту, що
  // мовчить.
  // Поріг мовчання — з ритму самої точки (checks.js, silenceLimit): період
  // задається на пристрої, і фіксоване число на сервері вже одного разу
  // перетворило дашборд на маятник.
  const { rows: points } = await pool.query(
    `select p.id, p.name,
            extract(epoch from (now() - p.last_seen_at)) / 60 as silent,
            t.period_s
       from points p
       left join lateral (
         select extract(epoch from (max(measured_at) - min(measured_at))) / nullif(count(*) - 1, 0) as period_s
           from (select measured_at from device_telemetry
                  where point_id = p.id and source = 'pi'
                  order by measured_at desc limit 10) recent) t on true
      where p.status = 'live'`
  );
  for (const p of points) {
    const ok = p.silent !== null && p.silent < silenceLimit(p.period_s ? Number(p.period_s) : null);
    targets.push([`point:${p.id}`, ok, ok ? null : p.silent === null ? "не озивалась жодного разу" : `мовчить ${Math.round(p.silent)} хв`]);

    // «Точка на зв'язку» — це лише про малину: кіоск може бездоганно
    // малювати у вимкнений монітор, а камери може не бути взагалі. Тому
    // поруч ще два ряди з тієї ж телеметрії (прохання власника 23.09.2026).
    // Мовчить точка — рядів не буде зовсім: додавати сюди false означало б
    // «монітор вимкнено», хоча ми просто не знаємо.
    if (!ok) continue;
    const { rows: [last] } = await pool.query(
      `select metrics from device_telemetry
        where point_id = $1 and source = 'pi'
        order by measured_at desc limit 1`,
      [p.id]
    );
    const m = last?.metrics ?? {};
    if (m.monitor_on !== undefined && m.monitor_on !== null) {
      targets.push([`point:${p.id}:monitor`, Boolean(m.monitor_on), m.monitor_on ? null : "монітор вимкнено або від'єднано"]);
    }
    if (m.video_ok !== undefined && m.video_ok !== null) {
      targets.push([`point:${p.id}:video`, Boolean(m.video_ok), m.video_ok ? null : "відеопотоку немає"]);
    }
  }

  // Відро — півгодини: 00:00–00:29 і 00:30–00:59.
  const D = "$";
  const values = targets.map((_, i) => `(${D}${i * 4 + 1}, ${D}${i * 4 + 2}, ${D}${i * 4 + 3}, ${D}${i * 4 + 4})`).join(", ");
  const params = targets.flatMap(([target, ok, detail, ms = null]) => [target, ok, detail, ms]);
  await pool.query(
    `insert into health_samples (target, bucket_start, ok, detail, ms_total, ms_count)
     select v.target, date_trunc('hour', now()) + make_interval(mins => (extract(minute from now())::int / 30) * 30),
            v.ok::boolean, v.detail,
            coalesce(v.ms::bigint, 0), case when v.ms is null then 0 else 1 end
       from (values ${values}) as v(target, ok, detail, ms)
     on conflict (target, bucket_start) do update
        set ok = health_samples.ok and excluded.ok,
            detail = coalesce(case when excluded.ok then null else excluded.detail end, health_samples.detail),
            ms_total = health_samples.ms_total + excluded.ms_total,
            ms_count = health_samples.ms_count + excluded.ms_count,
            samples = health_samples.samples + 1`,
    params
  );

  // Останній стан — ще й у Redis: адмінка бере його без запиту в Postgres
  // (docs/db-schema.md §5).
  const pipe = redis.multi();
  for (const [target, ok, detail] of targets) {
    pipe.hset(`health:last:${target}`, { ok: ok ? "1" : "0", detail: detail ?? "", at: new Date().toISOString() });
    pipe.expire(`health:last:${target}`, 3600);
  }
  await pipe.exec();

  await pool.query(`delete from health_samples where bucket_start < now() - make_interval(days => $1)`, [KEEP_DAYS]);

  const bad = targets.filter(([, ok]) => !ok);
  log?.info(`здоровʼя: ${targets.length - bad.length}/${targets.length}`, bad.length ? { впало: bad.map(([t]) => t) } : undefined);
  return { done: `${targets.length - bad.length}/${targets.length} цілей у нормі` };
}
