// Аналітика застосунку гравця: черга подій з Redis → analytics_events, і
// відра для дашборду «Аналітика» в адмінці (власник, 02.10.2026). Події
// пише api (src/analytics.js): кожен запит і кожна навігація.
//
// Дві роботи:
//   flushAnalytics     — раз на хвилину: черга → таблиця пачками;
//   aggregateAnalytics — раз на десять хвилин: денні відра (analytics_daily)
//                        за київські дні й готові зрізи за 1/7/30 діб
//                        (analytics_window), плюс прибирання.
//
// Чому зрізи, а не лише денні відра: унікальних людей, сесій, перцентилів і
// воронок за тиждень із денних не скласти — та сама людина за сім днів
// порахувалась би сім разів. Тож «за тиждень» рахується з сирих подій
// цілком, а денні відра — для графіків тренду.
import { ANALYTICS_ACTIONS, ANALYTICS_FUNNELS } from "@extrovert/lib/analytics.js";

const KEY = "analytics:events";
const FLUSH = "analytics:events:flush";
const CHUNK = 5000;
const TZ = "Europe/Kyiv";
const WINDOWS = [1, 7, 30];
// Сирі події — 90 діб: на місячний зріз із запасом і розбір «що було
// минулого місяця». Далі живуть лише денні відра.
const RAW_DAYS = 90;
// Пауза довша за пів години — нова сесія (звична межа в аналітиці).
const SESSION_GAP = "30 minutes";
// Маршрути не застосунку гравця: адмінка, точки, вебхуки — у клієнтських
// зрізах їм не місце.
const NOT_CLIENT = "^/(admin|points|webhook|dev)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP = /^[0-9a-f:.]{3,45}$/i;

// ── черга → таблиця ─────────────────────────────────────────────────────
// Той самий прийом, що з показами лотів (impressions.js): ключ атомарно
// перейменовується, нові події падають уже в новий. Обробляємо пачками й
// після кожної вкорочуємо список — упали посередині, і наступний прохід
// продовжить з того самого місця, без дублів.
export async function flushAnalytics({ pool, redis }) {
  if (!(await redis.exists(FLUSH))) {
    const renamed = await redis.renamenx(KEY, FLUSH).catch(() => 0);
    if (!renamed) return {};
  }
  let total = 0;
  for (;;) {
    const raw = await redis.lrange(FLUSH, 0, CHUNK - 1);
    if (!raw.length) break;
    const rows = raw.map((line) => {
      try {
        const e = JSON.parse(line);
        if (!Number.isFinite(e.at) || (e.type !== "nav" && e.type !== "api")) return null;
        return [e.at / 1000, UUID.test(e.user_id ?? "") ? e.user_id : null, IP.test(e.ip ?? "") ? e.ip : null, e.type, JSON.stringify(e.payload ?? null)];
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (rows.length) {
      await pool.query(
        `insert into analytics_events (at, user_id, ip, type, payload)
         select to_timestamp(a), u, i::inet, t, p::jsonb
           from unnest($1::float8[], $2::uuid[], $3::text[], $4::text[], $5::text[]) as x(a, u, i, t, p)`,
        [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3]), rows.map((r) => r[4])]
      );
    }
    await redis.ltrim(FLUSH, raw.length, -1);
    total += rows.length;
    if (raw.length < CHUNK) break;
  }
  return total ? { done: `подій перенесено: ${total}` } : {};
}

// ── зрізи ───────────────────────────────────────────────────────────────
// Події проміжку [$1, $2) без адмінки й точок; who — людина: акаунт, а
// гість — за адресою (у кав'ярні гості за одним Wi-Fi зливаються в одного,
// і це свідома межа: інакше довелося б мітити пристрій).
const EV = `
  ev as (
    select e.at, e.user_id, e.ip, e.type, e.payload,
           coalesce(e.user_id::text, 'ip:' || host(e.ip)) as who
      from analytics_events e
     where e.at >= $1 and e.at < $2
       and (e.type = 'nav' or (e.payload->>'route') !~ '${NOT_CLIENT}')
  )`;

// Сесії: події однієї людини з паузами не довшими за SESSION_GAP. Рахуємо
// лише сесії, де відкрили хоч один екран: фонові запити (оновлення токена)
// сесією не є.
const SESSIONS = `
  ${EV},
  marks as (
    select who, at, type, payload,
           case when lag(at) over w is null or at - lag(at) over w > interval '${SESSION_GAP}' then 1 else 0 end as fresh
      from ev window w as (partition by who order by at)
  ),
  numbered as (
    select *, sum(fresh) over (partition by who order by at rows between unbounded preceding and current row) as n from marks
  ),
  sess as (
    select who, n, min(at) as t0, max(at) as t1,
           count(*) filter (where type = 'nav') as screens,
           (array_agg(payload->>'screen' order by at) filter (where type = 'nav'))[1] as entry,
           (array_agg(payload->>'screen' order by at desc) filter (where type = 'nav'))[1] as exit,
           (array_agg(payload->>'platform' order by at) filter (where type = 'nav'))[1] as platform
      from numbered group by who, n
  ),
  app_sessions as (select * from sess where screens > 0)`;

const actionsValues = () => ANALYTICS_ACTIONS
  .map(([method, route, label]) => `('${method}', '${route.replace(/'/g, "''")}', '${label.replace(/'/g, "''")}')`).join(", ");

async function sliceMetrics(pool, from, to) {
  const out = [];
  const put = (metric, dim, value) => {
    const v = Number(value);
    if (Number.isFinite(v)) out.push([metric, dim == null ? "" : String(dim), v]);
  };
  const q = (sql, params = [from, to]) => pool.query(sql, params).then((r) => r.rows);

  // Аудиторія
  const [aud] = await q(`with ${EV}
    select count(distinct user_id) as users,
           count(distinct ip) filter (where user_id is null and type = 'nav') as guests,
           count(*) filter (where type = 'nav') as views,
           count(*) filter (where type = 'api') as requests,
           count(distinct (user_id, (at at time zone '${TZ}')::date)) filter (where user_id is not null) as user_days
      from ev`);
  put("users", "", aud.users);
  put("guests", "", aud.guests);
  put("views", "", aud.views);
  put("requests", "", aud.requests);
  put("user_days", "", aud.user_days);
  const [sign] = await q("select count(*) as n from users where created_at >= $1 and created_at < $2");
  put("signups", "", sign.n);
  const [ret] = await q(`with ${EV} select count(distinct ev.user_id) as n from ev join users u on u.id = ev.user_id where u.created_at < $1`);
  put("returning", "", ret.n);

  // Сесії
  const [ses] = await q(`with ${SESSIONS}
    select count(*) as sessions,
           percentile_cont(0.5) within group (order by extract(epoch from t1 - t0)) as median_s,
           percentile_cont(0.9) within group (order by extract(epoch from t1 - t0)) as p90_s,
           avg(screens) as screens,
           count(*) filter (where screens = 1) as single
      from app_sessions`);
  put("sessions", "", ses.sessions);
  put("session_median_s", "", ses.median_s ?? 0);
  put("session_p90_s", "", ses.p90_s ?? 0);
  put("screens_per_session", "", ses.screens ?? 0);
  put("single_screen_sessions", "", ses.single);
  for (const r of await q(`with ${SESSIONS} select entry as dim, count(*) as n from app_sessions where entry is not null group by 1`)) put("entry", r.dim, r.n);
  for (const r of await q(`with ${SESSIONS} select exit as dim, count(*) as n from app_sessions where exit is not null group by 1`)) put("exit", r.dim, r.n);
  for (const r of await q(`with ${SESSIONS} select coalesce(platform, 'other') as dim, count(*) as n, count(distinct who) as people from app_sessions group by 1`)) {
    put("platform_sessions", r.dim, r.n);
    put("platform_people", r.dim, r.people);
  }

  // Навігація
  for (const r of await q(`with ${EV} select payload->>'screen' as dim, count(*) as n, count(distinct who) as people from ev where type = 'nav' group by 1`)) {
    put("screen_views", r.dim, r.n);
    put("screen_people", r.dim, r.people);
  }
  for (const r of await q(`with ${EV}
      select (payload->>'from') || '→' || (payload->>'screen') as dim, count(*) as n
        from ev where type = 'nav' and payload ? 'from' and payload->>'from' <> payload->>'screen'
       group by 1 order by 2 desc limit 40`)) put("transition", r.dim, r.n);

  // Дії: успішні (статус < 400) запити, що означають щось для продукту.
  for (const r of await q(`with ${EV}, act(method, route, label) as (values ${actionsValues()})
      select a.label as dim, count(*) as n, count(distinct ev.who) as people
        from ev join act a on a.method = ev.payload->>'method' and a.route = ev.payload->>'route'
       where ev.type = 'api' and (ev.payload->>'status')::int < 400
       group by 1`)) {
    put("action_count", r.dim, r.n);
    put("action_people", r.dim, r.people);
  }

  // Час: середня кількість активних людей у годину доби й у день тижня.
  // «Активна» — відкрила хоч один екран у цю годину (цей день).
  const [span] = await q(`select greatest(1, round(extract(epoch from ($2::timestamptz - $1::timestamptz)) / 86400))::int as days`);
  for (const r of await q(`with ${EV}
      select extract(hour from hr)::int as h, count(*) as n
        from (select distinct who, date_trunc('hour', at at time zone '${TZ}') as hr from ev where type = 'nav') x
       group by 1`)) put("hour_people", r.h, r.n / span.days);
  for (const r of await q(`with ${EV},
        dows as (select extract(isodow from d)::int as dow, count(*) as k
                   from generate_series(($1::timestamptz at time zone '${TZ}')::date, (($2::timestamptz - interval '1 second') at time zone '${TZ}')::date, '1 day') d
                  group by 1)
      select x.dow, count(*)::float / max(dows.k) as n
        from (select distinct who, (at at time zone '${TZ}')::date as day, extract(isodow from at at time zone '${TZ}')::int as dow from ev where type = 'nav') x
        join dows on dows.dow = x.dow
       group by 1`)) put("weekday_people", r.dow, r.n);

  // Технічне: запити застосунку гравця за маршрутами.
  const [api] = await q(`with ${EV}
    select count(*) as n,
           count(*) filter (where (payload->>'status')::int >= 500) as e5,
           count(*) filter (where (payload->>'status')::int between 400 and 499) as e4,
           percentile_cont(0.5) within group (order by (payload->>'ms')::int) as p50,
           percentile_cont(0.95) within group (order by (payload->>'ms')::int) as p95
      from ev where type = 'api'`);
  put("api_requests", "", api.n);
  put("api_5xx", "", api.e5);
  put("api_4xx", "", api.e4);
  put("api_p50_ms", "", api.p50 ?? 0);
  put("api_p95_ms", "", api.p95 ?? 0);
  for (const r of await q(`with ${EV}
      select (payload->>'method') || ' ' || (payload->>'route') as dim, count(*) as n,
             count(*) filter (where (payload->>'status')::int >= 500) as e5,
             count(*) filter (where (payload->>'status')::int between 400 and 499) as e4,
             percentile_cont(0.5) within group (order by (payload->>'ms')::int) as p50,
             percentile_cont(0.95) within group (order by (payload->>'ms')::int) as p95
        from ev where type = 'api' group by 1`)) {
    put("route_requests", r.dim, r.n);
    put("route_5xx", r.dim, r.e5);
    put("route_4xx", r.dim, r.e4);
    put("route_p50_ms", r.dim, r.p50);
    put("route_p95_ms", r.dim, r.p95);
  }
  for (const r of await q(`with ${EV} select left(payload->>'status', 1) || 'xx' as dim, count(*) as n from ev where type = 'api' group by 1`)) put("api_status", r.dim, r.n);

  // Воронки: скільки людей пройшли кроки ПО ПОРЯДКУ (крок рахується, лише
  // якщо стався після попереднього). Рахуємо в коді: подій обмаль, а
  // впорядковану воронку на SQL читати важче, ніж писати.
  const screens = [...new Set(ANALYTICS_FUNNELS.flatMap(([, steps]) => steps.filter((s) => s[0] === "nav").flatMap((s) => [].concat(s[1]))))];
  const rows = await q(`with ${EV}, act(method, route, label) as (values ${actionsValues()})
      select ev.who, ev.at,
             case when ev.type = 'nav' then 'nav:' || (ev.payload->>'screen') else 'action:' || a.label end as key
        from ev left join act a on ev.type = 'api' and a.method = ev.payload->>'method' and a.route = ev.payload->>'route'
       where (ev.type = 'nav' and ev.payload->>'screen' = any($3))
          or (ev.type = 'api' and a.label is not null and (ev.payload->>'status')::int < 400)
       order by ev.who, ev.at`, [from, to, screens]);
  const byWho = new Map();
  for (const r of rows) {
    if (!byWho.has(r.who)) byWho.set(r.who, []);
    byWho.get(r.who).push(r.key);
  }
  for (const [name, steps] of ANALYTICS_FUNNELS) {
    const reached = steps.map(() => 0);
    const matches = (key, step) => [].concat(step[1]).some((v) => key === `${step[0]}:${v}`);
    for (const keys of byWho.values()) {
      let i = 0;
      for (const key of keys) {
        if (i < steps.length && matches(key, steps[i])) i++;
      }
      for (let k = 0; k < i; k++) reached[k]++;
    }
    steps.forEach((step, k) => put("funnel", `${name}|${k}|${step[2]}`, reached[k]));
  }
  return out;
}

// Утримання — когорта реєстрацій за 30 діб: яка частка повернулась
// наступного дня (D1) і на сьомий (D7). Лише ті, у кого цей день уже минув.
async function retention(pool) {
  const { rows: [r] } = await pool.query(`
    select count(*) filter (where u.created_at < now() - interval '2 days') as base1,
           count(*) filter (where u.created_at < now() - interval '2 days' and exists (
             select 1 from analytics_events e where e.user_id = u.id and e.at >= u.created_at + interval '1 day' and e.at < u.created_at + interval '2 days')) as d1,
           count(*) filter (where u.created_at < now() - interval '8 days') as base7,
           count(*) filter (where u.created_at < now() - interval '8 days' and exists (
             select 1 from analytics_events e where e.user_id = u.id and e.at >= u.created_at + interval '7 days' and e.at < u.created_at + interval '8 days')) as d7
      from users u where u.created_at >= now() - interval '30 days' and u.deleted_at is null`);
  return [
    ["retention_d1_base", "", Number(r.base1)], ["retention_d1", "", Number(r.d1)],
    ["retention_d7_base", "", Number(r.base7)], ["retention_d7", "", Number(r.d7)],
  ];
}

// У денні відра — лише те, що складається між днями або має сенс на день.
const DAILY = new Set(["users", "guests", "views", "requests", "signups", "sessions", "api_5xx", "screen_views", "action_count"]);

async function writeRows(pool, table, keyCol, keyVal, rows) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from ${table} where ${keyCol} = $1`, [keyVal]);
    if (rows.length) {
      await client.query(
        `insert into ${table} (${keyCol}, metric, dim, value)
         select $1, m, d, v from unnest($2::text[], $3::text[], $4::float8[]) as x(m, d, v)`,
        [keyVal, rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])]
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function aggregateAnalytics({ pool }) {
  const ret = await retention(pool);
  for (const days of WINDOWS) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400_000);
    await writeRows(pool, "analytics_window", "days", days, [...(await sliceMetrics(pool, from, to)), ...ret]);
  }

  // Денні відра: сьогодні й учора завжди (учорашні події ще могли доїхати
  // з черги), плюс дні з подіями, для яких відер ще немає (перший запуск).
  const { rows: days } = await pool.query(`
    select d::date::text as day from generate_series((now() at time zone '${TZ}')::date - 1, (now() at time zone '${TZ}')::date, '1 day') d
    union
    select distinct (at at time zone '${TZ}')::date::text from analytics_events
     where at > now() - interval '${RAW_DAYS} days'
       and (at at time zone '${TZ}')::date not in (select distinct day from analytics_daily)`);
  for (const { day } of days) {
    const { rows: [b] } = await pool.query(
      `select ($1::date::timestamp at time zone '${TZ}') as f, (($1::date + 1)::timestamp at time zone '${TZ}') as t`, [day]);
    const rows = (await sliceMetrics(pool, b.f, b.t)).filter(([m]) => DAILY.has(m));
    await writeRows(pool, "analytics_daily", "day", day, rows);
  }

  // Прибирання: сирі події старші за RAW_DAYS, і адреси видалених акаунтів
  // (видалення не має лишати по людині навіть IP).
  await pool.query(`delete from analytics_events where at < now() - interval '${RAW_DAYS} days'`);
  await pool.query(`update analytics_events e set ip = null from users u
                     where u.id = e.user_id and u.deleted_at is not null and e.ip is not null`);
  return { done: `зрізи аналітики перераховано (${days.length} дн.)` };
}
