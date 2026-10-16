// Аналітика відео для адмінки: відвідуваність, воронка до покупки, покупки
// з трьома митями й невдалі спроби (власник, 15.10.2026; заміри й пороги —
// аналіз архіву картки 09–14.10, docs/video.md «Люди й візити»).
//
// Усе рахується з того, що пише worker (backend/worker): проходи коридором
// (video_passages), люди й візити (video_people, video_visits — їх worker
// переписує за останню добу щоразу заново, тож тут лише читаємо) і події
// (video_events, без замінених переаналізом — superseded_at).
//
// Доба — київська, і для відвідувачів це «люди, яких камера бачила цього
// дня»: клуб цілодобовий, і нічний гість, що прийшов о 23:00 і пішов о 03:00,
// — відвідувач обох діб, а візит у нього один (video_visits).
import { presign } from "@extrovert/lib/r2.js";
import { many, one } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { pageInfo, pageOf } from "../paging.js";

const TZ = "Europe/Kyiv";

function range(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 86400_000);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to - from > 92 * 86400_000) fail(400, "bad_range");
  return { from: from.toISOString(), to: to.toISOString() };
}

// Покриття записом погодинно: скільки секунд години камера могла когось
// побачити. Малина пише безперервно — це самі сегменти; картка пише лише
// рух, і для неї покриття — проміжки, коли камера працювала (video_coverage,
// від першого до останнього кадру кожного файлу картки).
const COVER = `
  hours as (
    select h from generate_series(date_trunc('hour', $1::timestamptz), $2::timestamptz, interval '1 hour') h
  ),
  segs as (
    select started_at a, started_at + coalesce(duration_ms, 60000) * interval '1 millisecond' b
      from video_segments
     where source = 'pi' and status <> 'expired' and ($3 = '' or point_id = $3)
       and started_at between $1::timestamptz - interval '2 minutes' and $2
    union all
    select started_at, ended_at from video_coverage
     where ($3 = '' or point_id = $3) and ended_at > $1 and started_at < $2
  ),
  cover as (
    -- least/greatest у Postgres пропускають null: без filter година без
    -- жодного сегмента рахувалась би повною. Сегменти малини трохи
    -- накладаються (кожен на кілька секунд), тож стеля — година.
    select h.h, least(3600, coalesce(sum(extract(epoch from least(s.b, h.h + interval '1 hour') - greatest(s.a, h.h)))
                                     filter (where s.a is not null), 0)) as secs
      from hours h left join segs s on s.a < h.h + interval '1 hour' and s.b > h.h
     group by h.h
  )`;

export default async function routes(app) {
  app.get("/admin/video/analytics", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const point = String(req.query.point ?? "");
    const p = [from, to, point];

    // Відвідувачі за добу й воронка «відвідувачі → біля автомата → купили».
    // Персонал (video_people.staff) — окремо: адміністратор за зміну проходить
    // коридором 50–80 разів і зʼїв би будь-яку частку.
    const days = await many(
      `select to_char(pa.started_at at time zone '${TZ}', 'YYYY-MM-DD') as day,
              count(distinct pa.person_id) filter (where not pe.staff) as visitors,
              count(distinct pa.person_id) filter (where pe.staff) as staff,
              count(distinct pa.person_id) filter (where not pe.staff and pa.at_machine) as at_machine,
              count(distinct pa.person_id) filter (where not pe.staff and pa.receipt_id is not null) as buyers,
              count(*)::int as passages,
              count(*) filter (where pa.heading = 'in')::int as entries,
              count(*) filter (where pa.heading = 'out')::int as exits
         from video_passages pa left join video_people pe on pe.id = pa.person_id
        where pa.started_at between $1 and $2 and ($3 = '' or pa.point_id = $3)
        group by 1 order by 1`,
      p
    );
    const receiptsByDay = await many(
      `select to_char(fiscal_date at time zone '${TZ}', 'YYYY-MM-DD') as day, count(*)::int as receipts
         from receipts where fiscal_date between $1 and $2 and ($3 = '' or point_id = $3) and receipt_in_stats(id)
        group by 1`,
      p
    );
    const funnel = await one(
      `select count(distinct pa.person_id) filter (where not pe.staff)::int as visitors,
              count(distinct pa.person_id) filter (where not pe.staff and pa.at_zone)::int as at_cafe,
              count(distinct pa.person_id) filter (where not pe.staff and pa.at_machine)::int as at_machine,
              count(distinct pa.person_id) filter (where not pe.staff and pa.receipt_id is not null)::int as buyers,
              count(distinct pa.receipt_id)::int as receipts_on_video
         from video_passages pa join video_people pe on pe.id = pa.person_id
        where pa.started_at between $1 and $2 and ($3 = '' or pa.point_id = $3)`,
      p
    );

    // Профіль години: скільки різних гостей камера бачить за годину і скільки
    // в цю годину в клубі (від входу до виходу візиту; невідомий кінець —
    // перший чи останній прохід людини). Ділимо на кількість діб, коли ця
    // година була покрита записом, — інакше години без камери тягнули б
    // середнє вниз.
    const hourly = await many(
      `with ${COVER},
       covered as (select extract(hour from h at time zone '${TZ}')::int as hour, count(*) as days
                     from cover where secs >= 1800 group by 1),
       seen as (
         select extract(hour from date_trunc('hour', pa.started_at) at time zone '${TZ}')::int as hour,
                count(distinct (pa.person_id, date_trunc('hour', pa.started_at))) as n
           from video_passages pa join video_people pe on pe.id = pa.person_id
          where not pe.staff and pa.started_at between $1 and $2 and ($3 = '' or pa.point_id = $3)
          group by 1),
       spans as (
         select coalesce(v.entered_at, pe.first_seen) as a, coalesce(v.left_at, pe.last_seen) as b
           from video_visits v join video_people pe on pe.id = v.person_id
          where not pe.staff and ($3 = '' or v.point_id = $3)
            and coalesce(v.left_at, pe.last_seen) > $1 and coalesce(v.entered_at, pe.first_seen) < $2),
       present as (
         select extract(hour from h at time zone '${TZ}')::int as hour, count(*) as n
           from spans, generate_series(date_trunc('hour', a), b, interval '1 hour') h
          where h between $1 and $2
          group by 1)
       select c.hour, c.days::int,
              round(coalesce(s.n, 0)::numeric / c.days, 1)::float as seen,
              round(coalesce(pr.n, 0)::numeric / c.days, 1)::float as present
         from covered c left join seen s using (hour) left join present pr using (hour)
        order by 1`,
      p
    );

    // Скільки сидять: лише візити з обома кінцями. Їх меншість — вхід чи
    // вихід часто припадає на блекаут або впізнавання не зводить спину з
    // обличчям, — тож поруч і кількість, щоб було видно, з чого медіана.
    const dwell = await one(
      `with v as (
         select extract(epoch from v.left_at - v.entered_at) / 60 as m
           from video_visits v join video_people pe on pe.id = v.person_id
          where not pe.staff and v.entered_at between $1 and $2 and v.left_at is not null
            and ($3 = '' or v.point_id = $3))
       select count(*)::int as closed,
              round(percentile_cont(0.5) within group (order by m)::numeric, 0)::float as median_min,
              round(avg(m)::numeric, 0)::float as mean_min,
              count(*) filter (where m < 15)::int as b15,
              count(*) filter (where m >= 15 and m < 30)::int as b30,
              count(*) filter (where m >= 30 and m < 60)::int as b60,
              count(*) filter (where m >= 60 and m < 120)::int as b120,
              count(*) filter (where m >= 120 and m < 240)::int as b240,
              count(*) filter (where m >= 240)::int as b_more,
              (select count(*)::int from video_visits v2 join video_people p2 on p2.id = v2.person_id
                where not p2.staff and ($3 = '' or v2.point_id = $3)
                  and coalesce(v2.entered_at, v2.left_at) between $1 and $2) as all_visits
         from v`,
      p
    );

    // Смужка покриття: погодинно — частка години, яку писала камера, і чи
    // була на звʼязку кавомашина (Jetinno онлайн = на точці є світло; власник,
    // 14.10.2026). Пробу Jetinno scheduler робить раз на ~25 хв, тож годину
    // без проби лишаємо невідомою, а не «вимкненою».
    const coverage = await many(
      `with ${COVER},
       jet as (
         select date_trunc('hour', measured_at) as h,
                count(*) filter (where metrics->>'online' = 'true')::int as up,
                count(*)::int as n
           from device_telemetry
          where source = 'jetinno' and measured_at between $1 and $2 and ($3 = '' or point_id = $3)
          group by 1)
       select c.h as hour, round(c.secs)::int as video_s, j.up, j.n
         from cover c left join jet j on j.h = c.h
        order by 1`,
      p
    );

    // Події по три години — разом із чеками, щоб видно було, коли люди є, а
    // покупок немає.
    const events3h = await many(
      `with b as (
         select to_timestamp(floor(extract(epoch from started_at) / 10800) * 10800) as bucket, kind
           from video_events
          where superseded_at is null and started_at between $1 and $2 and ($3 = '' or point_id = $3))
       select bucket, kind, count(*)::int as n from b group by 1, 2
       union all
       select to_timestamp(floor(extract(epoch from fiscal_date) / 10800) * 10800), 'receipt', count(*)::int
         from receipts where fiscal_date between $1 and $2 and ($3 = '' or point_id = $3) and receipt_in_stats(id)
        group by 1
       order by 1`,
      p
    );

    // Що пʼють: позиції чеків (receipt_items) за назвою напою.
    const drinks = await many(
      `select coalesce(d.name, i.name) as name, sum(i.qty)::float as qty
         from receipts r join receipt_items i on i.receipt_id = r.id
         left join drinks d on d.slot = i.slot
        where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3) and receipt_in_stats(r.id)
        group by 1 order by 2 desc`,
      p
    );

    // Втрачені вікна: години, коли гості в коридорі були, а кавомашина — ні
    // на звʼязку (немає світла чи звʼязку в неї).
    const lost = await many(
      `with jet as (
         select date_trunc('hour', measured_at) as h,
                bool_and(metrics->>'online' = 'false') as down
           from device_telemetry
          where source = 'jetinno' and measured_at between $1 and $2 and ($3 = '' or point_id = $3)
          group by 1),
       seen as (
         select date_trunc('hour', pa.started_at) as h, count(distinct pa.person_id) as people
           from video_passages pa join video_people pe on pe.id = pa.person_id
          where not pe.staff and pa.started_at between $1 and $2 and ($3 = '' or pa.point_id = $3)
          group by 1)
       select s.h as hour, s.people::int from seen s join jet j on j.h = s.h where j.down order by 1`,
      p
    );

    return {
      from, to, days, receipts_by_day: receiptsByDay, funnel, hourly, dwell, coverage,
      events3h, drinks, lost,
    };
  });

  // Покупки з відео: кожен чек — три миті (вибір напою, оплата, напій
  // готовий), хто стояв біля автомата в мить оплати і наскільки впевнено, і
  // аркуш-доказ події. Вибір — час у номері замовлення машини
  // (2026101016171720… → 16:17:17 за Києвом), готовий — purchased_at
  // замовлення; замовлення шукаємо за ціною в межах трьох хвилин від чека.
  app.get("/admin/video/purchases", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const point = String(req.query.point ?? "");
    const p = [from, to, point];
    // Дві таблиці на екрані — дві незалежні сторінки (p_page, a_page).
    const pp = pageOf(req.query, { per: 25 }, "p_");
    const ap = pageOf(req.query, { per: 25 }, "a_");
    const purchases = await many(
      `select r.id, r.point_id, r.fiscal_date as paid, r.total_sum::float as total, receipt_in_stats(r.id) as in_stats,
              o.purchased_at as done, o.product_id, d.name as drink,
              case when ltrim(o.order_no, '\`') ~ '^\\d{14}'
                   then (to_timestamp(left(ltrim(o.order_no, '\`'), 14), 'YYYYMMDDHH24MISS')
                         at time zone current_setting('TimeZone')) at time zone '${TZ}' end as selected,
              pa.id as passage_id, pa.receipt_match, pa.person_id, pa.crops, pa.direction,
              pe.staff, pe.passages as person_passages, pe.first_seen, pe.last_seen,
              e.id as event_id, e.kind as event_kind, e.evidence,
              (select count(*)::int from video_segments s
                where s.point_id = r.point_id and s.status = 'done'
                  and r.fiscal_date between s.started_at and s.started_at + coalesce(s.duration_ms, 60000) * interval '1 millisecond')
                as on_video
         from receipts r
         left join lateral (
           select * from machine_orders o
            where o.point_id = r.point_id and o.price_uah = r.total_sum
              and o.purchased_at between r.fiscal_date - interval '3 minutes' and r.fiscal_date + interval '3 minutes'
            order by abs(extract(epoch from o.purchased_at - r.fiscal_date)) limit 1) o on true
         left join drinks d on d.slot ~ '^\\d+$' and d.slot::int = o.product_id
         left join video_passages pa on pa.receipt_id = r.id
         left join video_people pe on pe.id = pa.person_id
         left join lateral (
           select id, kind, evidence from video_events e
            where e.likely_receipt_id = r.id and e.superseded_at is null
            order by e.kind = 'machine' desc limit 1) e on true
        where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3)
        order by r.fiscal_date desc, r.id desc limit $4 offset $5`,
      [...p, pp.per, pp.offset]
    );
    // KPI — з усього періоду, а не з видимої сторінки: досі «Чеків» і
    // «Покупця видно» рахувались по обрізаному до 200 списку (16.10.2026).
    const kpi = await one(
      `select count(*)::int as receipts,
              count(*) filter (where receipt_in_stats(r.id))::int as real,
              count(*) filter (where receipt_in_stats(r.id)
                                 and exists (select 1 from video_passages pa where pa.receipt_id = r.id))::int as seen
         from receipts r
        where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3)`,
      p
    );

    // Невдалі спроби: людина простояла біля автомата від 20 с, а чека поруч
    // немає. Поруч — стан мережі малини (втрати й затримка на 4G) і чи
    // кавомашина була на звʼязку: 14.10 о 23:36 саме так платіж не пройшов —
    // LTE губив 16–28 % пакетів, а термінал іншого каналу не має.
    const attemptsFrom = `from video_events e
         left join video_passages pa on pa.id = e.passage_id
         left join video_people pe on pe.id = pa.person_id
        where e.kind = 'machine' and e.superseded_at is null
          and e.ended_at - e.started_at >= interval '20 seconds'
          and e.started_at between $1 and $2 and ($3 = '' or e.point_id = $3)
          and not exists (select 1 from receipts r
                           where r.point_id = e.point_id
                             and r.fiscal_date between e.started_at - interval '30 seconds' and e.ended_at + interval '60 seconds')`;
    const attemptCount = await one(
      `select count(*)::int as total, count(*) filter (where not coalesce(pe.staff, false))::int as guests ${attemptsFrom}`,
      p
    );
    const attempts = await many(
      `select e.id, e.point_id, e.started_at, e.ended_at, e.evidence, e.passage_id,
              extract(epoch from e.ended_at - e.started_at)::int as secs,
              pe.staff, pa.person_id, jsonb_array_length(coalesce(pa.crops, '[]')) as crops,
              (select json_build_object(
                        'loss_max', max((t.metrics->>'loss_pct')::float),
                        'ping_max', max((t.metrics->>'ping_ms')::float),
                        'uplinks', array_agg(distinct t.metrics->>'uplink') filter (where t.metrics ? 'uplink'),
                        'samples', count(*))
                 from device_telemetry t
                where t.point_id = e.point_id and t.source = 'pi'
                  and t.measured_at between e.started_at - interval '5 minutes' and e.ended_at + interval '2 minutes') as net,
              (select t.metrics->>'online' from device_telemetry t
                where t.point_id = e.point_id and t.source = 'jetinno' and t.measured_at <= e.ended_at
                order by t.measured_at desc limit 1) as machine_online
         ${attemptsFrom}
        order by e.started_at desc, e.id desc limit $4 offset $5`,
      [...p, ap.per, ap.offset]
    );
    return {
      from, to, purchases, attempts,
      kpi: { ...kpi, attempts_guests: attemptCount.guests },
      purchases_page: pageInfo(pp, kpi.receipts),
      attempts_page: pageInfo(ap, attemptCount.total),
    };
  });

  // Вирізки проходу (смужка в extrovert-evidence, worker/crops.py). Ключ —
  // з бази, не з запиту: інакше адмінка підписала б будь-який обʼєкт бакета.
  app.get("/admin/video/passages/:id/crops/:i", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const row = await one("select crops from video_passages where id = $1", [req.params.id]);
    const key = row?.crops?.[Number(req.params.i)]?.key;
    if (typeof key !== "string") fail(404, "no_such_crops");
    const { url } = presign({ method: "GET", purpose: "evidence", key, expiresIn: 600 });
    return { url };
  });
}
