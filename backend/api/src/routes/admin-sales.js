// Продажі для адмінки: дашборд «Продажі» (відвідуваність, воронка до
// покупки, покупки по днях, що пʼють), список «Покупки» — кожен чек із
// бонусом, трьома митями й тим, хто стояв біля автомата, — невдалі спроби й
// дашборд «Фінанси» (docs/admin_panel.md).
//
// До 18.10.2026 це було два екрани відео («Аналітика», «Покупці») і два
// поза ним («Статистика», «Покупки»), і той самий чек показували чотири
// місця з різними підрахунками. Тепер кожен показник має одне місце.
//
// Відео рахує worker (backend/worker): проходи коридором (video_passages),
// люди й візити (video_people, video_visits — їх worker переписує за останню
// добу щоразу заново, тож тут лише читаємо) і події (video_events, без
// замінених переаналізом — superseded_at). Пороги й заміри — docs/video.md,
// «Люди й візити».
//
// Доба — київська. Для відвідувачів це «люди, яких камера бачила цього
// дня»: клуб цілодобовий, і нічний гість, що прийшов о 23:00 і пішов о 03:00,
// — відвідувач обох діб, а візит у нього один (video_visits).
import { many, one } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { pageInfo, pageOf } from "../paging.js";

const TZ = "Europe/Kyiv";
const DAY = 86400_000;

// Проміжок дат: from/to з екрана або останні `days` діб. Відеоаналітика
// рахує погодинні ряди, тож її стеля — 92 доби; списки й гроші — без стелі.
function range(query, days, maxDays = Infinity) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - days * DAY);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to - from > maxDays * DAY) fail(400, "bad_range");
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

// Невдалі спроби: людина простояла біля автомата від 20 с, а чека поруч
// немає. Спільне для списку спроб і KPI над чеками.
const ATTEMPTS_FROM = `from video_events e
         left join video_passages pa on pa.id = e.passage_id
         left join video_people pe on pe.id = pa.person_id
        where e.kind = 'machine' and e.superseded_at is null
          and e.ended_at - e.started_at >= interval '20 seconds'
          and e.started_at between $1 and $2 and ($3 = '' or e.point_id = $3)
          and not exists (select 1 from receipts r
                           where r.point_id = e.point_id
                             and r.fiscal_date between e.started_at - interval '30 seconds' and e.ended_at + interval '60 seconds')`;

// KPI над «Покупками» — з усього періоду, а не з видимої сторінки: досі
// «Чеків» і «Покупця видно» рахувались по обрізаному до 200 списку
// (16.10.2026). Без тестових і власника (receipt_in_stats).
async function purchaseKpi(p) {
  const kpi = await one(
    `select count(*)::int as receipts,
            count(*) filter (where receipt_in_stats(r.id))::int as real,
            count(*) filter (where receipt_in_stats(r.id) and exists
              (select 1 from bonus_grants b where b.receipt_id = r.id and b.status = 'redeemed'))::int as redeemed,
            count(*) filter (where receipt_in_stats(r.id) and exists
              (select 1 from video_passages pa where pa.receipt_id = r.id))::int as seen
       from receipts r
      where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3)`,
    p
  );
  const attempts = await one(
    `select count(*)::int as total, count(*) filter (where not coalesce(pe.staff, false))::int as guests ${ATTEMPTS_FROM}`,
    p
  );
  return { ...kpi, attempts: attempts.total, attempts_guests: attempts.guests };
}

export default async function routes(app) {
  // ── Дашборд «Продажі» ───────────────────────────────────────────────
  app.get("/admin/sales", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query, 7, 92);
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
    // Покупки за київську добу — по точках (графік «Покупки за добу», до
    // 18.10.2026 жив на «Статистиці» в UTC-добах). Сума по точках — це й
    // стовпчик «чеків» у таблиці днів.
    const receiptsByDay = await many(
      `select to_char(r.fiscal_date at time zone '${TZ}', 'YYYY-MM-DD') as day, r.point_id,
              coalesce(pt.name, r.point_id) as point_name, count(*)::int as receipts
         from receipts r left join points pt on pt.id = r.point_id
        where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3) and receipt_in_stats(r.id)
        group by 1, 2, 3 order by 1`,
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

  // ── «Покупки»: кожен чек ────────────────────────────────────────────
  // Позиції, бонус і хто його забрав (Checkbox), три миті покупки — вибір
  // напою, оплата, напій готовий — і хто стояв біля автомата в мить оплати
  // з аркушем-доказом події (відео). Вибір — час у номері замовлення машини
  // (2026101016171720… → 16:17:17 за Києвом), готовий — purchased_at
  // замовлення; замовлення шукаємо за ціною в межах трьох хвилин від чека.
  // Список — усі чеки, разом із тестовими (їх видно позначкою); KPI — без них.
  app.get("/admin/receipts", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query, 30);
    const point = String(req.query.point ?? "");
    const p = [from, to, point];
    const pg = pageOf(req.query, { per: 25 });
    const receipts = await many(
      `select r.id, r.point_id, coalesce(pt.name, r.point_id) as point_name, r.fiscal_date, r.total_sum::float as total_sum,
              r.source, r.tax_url, receipt_in_stats(r.id) as in_stats,
              (select json_agg(json_build_object('name', i.name, 'qty', i.qty, 'sum', i.sum_uah, 'bonus', i.is_bonus_drink) order by i.id)
                 from receipt_items i where i.receipt_id = r.id) as items,
              b.status as bonus_status, b.coins_yellow as bonus_coins, b.redeemed_at,
              u.id as redeemed_by, u.nickname as redeemed_nickname, u.stats_excluded as redeemed_excluded,
              o.purchased_at as done, o.product_id, d.name as drink, o.status as order_status,
              -- Невдале замовлення машини («Неуспішно») — і що вона казала про
              -- себе найближчою пробою порталу після нього (ERROR:7B00…).
              case when o.status is not null and o.status <> 'Успішно' then
                (select coalesce(t.metrics -> 'fault_codes' ->> 0, t.metrics -> 'faults_recent_24h' ->> 0)
                   from device_telemetry t
                  where t.point_id = r.point_id and t.source = 'jetinno'
                    and t.measured_at between o.purchased_at and o.purchased_at + interval '60 minutes'
                  order by t.measured_at limit 1) end as fault,
              (select json_build_object('at', rr.fiscal_date, 'sum', rr.total_sum::float, 'tax_url', rr.raw ->> 'tax_url')
                 from receipt_returns rr where rr.receipt_id = r.id order by rr.fiscal_date limit 1) as refund,
              case when ltrim(o.order_no, '\`') ~ '^\\d{14}'
                   then (to_timestamp(left(ltrim(o.order_no, '\`'), 14), 'YYYYMMDDHH24MISS')
                         at time zone current_setting('TimeZone')) at time zone '${TZ}' end as selected,
              pa.id as passage_id, pa.receipt_match, pa.person_id, pa.crops, pe.staff,
              e.id as event_id, e.kind as event_kind, e.evidence,
              (select count(*)::int from video_segments s
                where s.point_id = r.point_id and s.status = 'done'
                  and r.fiscal_date between s.started_at and s.started_at + coalesce(s.duration_ms, 60000) * interval '1 millisecond')
                as on_video
         from receipts r
         left join points pt on pt.id = r.point_id
         left join bonus_grants b on b.receipt_id = r.id
         left join users u on u.id = b.redeemed_by
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
      [...p, pg.per, pg.offset]
    );
    const kpi = await purchaseKpi(p);
    return { from, to, receipts, kpi, page: pageInfo(pg, kpi.receipts) };
  });

  // Невдалі спроби — окремою вкладкою «Покупок». Поруч — стан мережі
  // малини (втрати й затримка) і чи кавомашина була на звʼязку: 14.10 о
  // 23:36 саме так платіж не пройшов — LTE губив 16–28 % пакетів, а термінал
  // іншого каналу не має.
  app.get("/admin/receipts/attempts", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query, 30);
    const point = String(req.query.point ?? "");
    const p = [from, to, point];
    const pg = pageOf(req.query, { per: 25 });
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
         ${ATTEMPTS_FROM}
        order by e.started_at desc, e.id desc limit $4 offset $5`,
      [...p, pg.per, pg.offset]
    );
    const kpi = await purchaseKpi(p);
    return { from, to, attempts, kpi, page: pageInfo(pg, kpi.attempts) };
  });

  // ── Дашборд «Фінанси» ───────────────────────────────────────────────
  // Виручка — сума чеків Checkbox без тестових і власника
  // (receipt_in_stats), по київських добах і точках, за годиною дня й днем
  // тижня. До 18.10.2026 ці графіки жили на «Статистиці» й рахували добу в
  // UTC: покупка о 01:30 за Києвом потрапляла в учорашній день.
  app.get("/admin/finance", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query, 30);
    const p = [from, to];
    // Виручка — продажі мінус повернення (receipt_returns, 23.10.2026):
    // повернення зменшує виручку в день повернення. Досі воно лежало серед
    // чеків зі знаком плюс — зіпсоване лате 22.10 дало +120 ₴ замість −60.
    const revenue = await many(
      `with s as (
         select to_char(r.fiscal_date at time zone '${TZ}', 'YYYY-MM-DD') as day, r.point_id,
                sum(r.total_sum) as sales, count(*)::int as receipts
           from receipts r
          where r.fiscal_date between $1 and $2 and receipt_in_stats(r.id)
          group by 1, 2
       ), rf as (
         select to_char(rr.fiscal_date at time zone '${TZ}', 'YYYY-MM-DD') as day, rr.point_id,
                sum(rr.total_sum) as refunds, count(*)::int as refunds_n
           from receipt_returns rr
          where rr.fiscal_date between $1 and $2 and receipt_return_in_stats(rr.id)
          group by 1, 2
       )
       select day, point_id, coalesce(pt.name, point_id) as point_name,
              (coalesce(s.sales, 0) - coalesce(rf.refunds, 0))::float as sum_uah,
              coalesce(s.receipts, 0) as receipts,
              coalesce(rf.refunds, 0)::float as refund_uah, coalesce(rf.refunds_n, 0) as refunds
         from s full join rf using (day, point_id)
         left join points pt on pt.id = point_id
        order by day`,
      p
    );
    // Дохід за годиною дня й за днем тижня — два зрізи того самого чека.
    // Київський час: «о восьмій ранку» має означати восьму в залі. Без
    // повернутих продажів: вони не відповідають на «коли купують».
    const SOLD = `r.fiscal_date between $1 and $2 and receipt_in_stats(r.id)
                  and not exists (select 1 from receipt_returns rr where rr.receipt_id = r.id)`;
    const byHour = await many(
      `select extract(hour from r.fiscal_date at time zone '${TZ}')::int as hour,
              sum(r.total_sum)::float as sum_uah, count(*)::int as receipts
         from receipts r where ${SOLD}
        group by 1 order by 1`,
      p
    );
    const byWeekday = await many(
      `select extract(isodow from r.fiscal_date at time zone '${TZ}')::int as weekday,
              sum(r.total_sum)::float as sum_uah, count(*)::int as receipts
         from receipts r where ${SOLD}
        group by 1 order by 1`,
      p
    );
    const totals = await one(
      `select (coalesce((select sum(total_sum) from receipts where fiscal_date between $1 and $2 and receipt_in_stats(id)), 0)
               - coalesce((select sum(total_sum) from receipt_returns rr where fiscal_date between $1 and $2 and receipt_return_in_stats(rr.id)), 0))::float as revenue,
              (select count(*) from receipts where fiscal_date between $1 and $2 and receipt_in_stats(id))::int as receipts,
              (select count(*) from receipt_returns rr where fiscal_date between $1 and $2 and receipt_return_in_stats(rr.id))::int as refunds,
              coalesce((select sum(total_sum) from receipt_returns rr where fiscal_date between $1 and $2 and receipt_return_in_stats(rr.id)), 0)::float as refund_uah`,
      p
    );

    // Собівартість (docs/stock.md): розрахункова витрата матеріалів за
    // кожним замовленням машини (stock_usage) × середня ціна закупки, плюс
    // щодобова витрата. Сюди йдуть і тестові чашки, і напої власника — це
    // справжні гроші, хоч виручки з них немає.
    const COST = `cost as (select item_id, sum(cost_uah) / nullif(sum(qty), 0) as unit
                             from stock_purchase_lines where kind = 'material' group by 1)`;
    const cogs = await many(
      `with ${COST}
       select to_char(u.used_at at time zone '${TZ}', 'YYYY-MM-DD') as day, sum(u.qty * c.unit)::float as cogs
         from stock_usage u join cost c on c.item_id = u.item_id
        where u.used_at between $1 and $2
        group by 1 order by 1`,
      p
    );
    const daily = await one(
      `with ${COST}
       select coalesce(sum(i.per_day * c.unit), 0)::float as uah from stock_items i join cost c on c.item_id = i.id where i.active`
    );
    // Закупки й інші витрати — за днем отримання, окремо матеріали, CAPEX і OPEX.
    const spend = await many(
      `select to_char(p.received_at at time zone '${TZ}', 'YYYY-MM-DD') as day,
              coalesce(sum(l.cost_uah) filter (where l.kind = 'material'), 0)::float as material,
              coalesce(sum(l.cost_uah) filter (where l.kind = 'capex'), 0)::float as capex,
              coalesce(sum(l.cost_uah) filter (where l.kind = 'opex'), 0)::float as opex
         from stock_purchases p join stock_purchase_lines l on l.purchase_id = p.id
        where p.received_at between $1 and $2
        group by 1 order by 1`,
      p
    );
    // Податок 5 % + 1 % і еквайринг — OPEX, що рахується сам із кожного чека
    // (подання opex_auto, ставки з датою в opex_rates): як сплачені одразу.
    const fees = await many(
      `select day::text as day,
              coalesce(sum(cost_uah) filter (where kind = 'tax'), 0)::float as tax,
              coalesce(sum(cost_uah) filter (where kind = 'acquiring'), 0)::float as acquiring
         from opex_auto
        where day between ($1::timestamptz at time zone '${TZ}')::date and ($2::timestamptz at time zone '${TZ}')::date
        group by 1 order by 1`,
      p
    );
    const rates = Object.fromEntries((await many(
      `select distinct on (kind) kind, rate::float as rate from opex_rates
        where valid_from <= current_date order by kind, valid_from desc`
    )).map((r) => [r.kind, r.rate]));
    // Заплановані платежі — закупки з датою в майбутньому (відсотки за
    // розстрочкою): у витрати вони потрапляють у свій день, а до того видно,
    // що попереду.
    const upcoming = await many(
      `select p.id, p.received_at, p.supplier, l.kind, l.category, l.description, l.cost_uah::float as cost_uah
         from stock_purchases p join stock_purchase_lines l on l.purchase_id = p.id
        where p.received_at > now()
        order by p.received_at, l.id`
    );
    // Вартість запасів на кінець кожної доби — з журналу залишків.
    const stockValue = await many(
      `with ${COST}
       select d.day::text as day, sum(greatest(d.book_qty, 0) * c.unit)::float as value
         from stock_daily d join cost c on c.item_id = d.item_id
        where d.book_qty is not null and d.day between ($1::timestamptz at time zone '${TZ}')::date and ($2::timestamptz at time zone '${TZ}')::date
        group by 1 order by 1`,
      p
    );
    // Окупність — з самого початку, а не за обраний період: скільки
    // валового прибутку мінус OPEX (і податку з еквайрингом) уже повернуло
    // вкладене в CAPEX. Закупки з датою в майбутньому — ще не витрата.
    const LINES = `stock_purchase_lines l join stock_purchases p on p.id = l.purchase_id`;
    const ever = await one(
      `with ${COST}
       select ((select coalesce(sum(total_sum), 0) from receipts where receipt_in_stats(id))
               - (select coalesce(sum(total_sum), 0) from receipt_returns rr where receipt_return_in_stats(rr.id)))::float as revenue,
              (select coalesce(sum(u.qty * c.unit), 0) from stock_usage u join cost c on c.item_id = u.item_id)::float as cogs,
              (select coalesce(sum(l.cost_uah), 0) from ${LINES} where l.kind = 'capex' and p.received_at <= now())::float as capex,
              (select coalesce(sum(l.cost_uah), 0) from ${LINES} where l.kind = 'opex' and p.received_at <= now())::float as opex,
              (select coalesce(sum(cost_uah), 0) from opex_auto)::float as fees,
              (select min(fiscal_date) from receipts) as since`
    );
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / DAY));
    const cogsSum = cogs.reduce((s, r) => s + r.cogs, 0) + daily.uah * days;
    const spendSum = (k) => spend.reduce((s, r) => s + r[k], 0);
    const feeSum = (k) => fees.reduce((s, r) => s + r[k], 0);
    const opex = spendSum("opex"), tax = feeSum("tax"), acquiring = feeSum("acquiring");
    return {
      from, to, totals: {
        ...totals,
        cogs: cogsSum,
        gross: totals.revenue - cogsSum,
        material: spendSum("material"), capex: spendSum("capex"), opex, tax, acquiring,
        // Операційний прибуток: валовий мінус OPEX, податок і еквайринг.
        operating: totals.revenue - cogsSum - opex - tax - acquiring,
        stock_value: stockValue.at(-1)?.value ?? null,
        daily_cost: daily.uah,
      },
      revenue, by_hour: byHour, by_weekday: byWeekday, cogs, spend, fees, rates, upcoming, stock_value: stockValue, ever,
    };
  });
}
