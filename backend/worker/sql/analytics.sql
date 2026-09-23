-- Запити, заради яких воркер і пише події. Тут вони лежать як чернетка для
-- адмінки (docs/admin_panel.md, група «відео») і як спосіб перевірити, що
-- з подій справді виходить те, що ми обіцяли собі отримати.
--
-- Жоден із них не йде в міграцію вʼюхою: поки камери немає, форма відповіді
-- точно зміниться, а вʼюха в схемі — це обіцянка, яку доведеться тримати.

-- 1. Картка «Події з камер» на дашборді статистики: скільки чого за добу.
select date_trunc('day', started_at) as day,
       kind,
       count(*) as n,
       round(avg(extract(epoch from (ended_at - started_at)))::numeric, 1) as avg_s
  from video_events
 where point_id = $1 and started_at >= $2 and started_at < $3
 group by 1, 2
 order by 1, 2;

-- 2. Конверсія підхід → покупка. Головне число всієї підсистеми: скільки
--    людей підійшло й пішло без кави. Саме ця пара чисел виправдовує камеру.
select date_trunc('day', started_at) as day,
       count(*) as approaches,
       count(likely_receipt_id) as bought,
       round(100.0 * count(likely_receipt_id) / nullif(count(*), 0), 1) as pct
  from video_events
 where kind = 'approach' and point_id = $1
   and started_at >= $2 and started_at < $3
 group by 1
 order by 1;

-- 3. Скільки стоять ті, хто купив, і ті, хто ні. Якщо «не купили» стоять
--    довго — це не байдужість, це незрозумілий інтерфейс або черга.
select likely_receipt_id is not null as bought,
       count(*) as n,
       round(avg((meta->>'dwell_ms')::int) / 1000.0, 1) as avg_s,
       round(percentile_cont(0.9) within group (
             order by (meta->>'dwell_ms')::int) / 1000.0, 1) as p90_s
  from video_events
 where kind = 'approach' and point_id = $1
   and started_at >= $2 and started_at < $3
 group by 1;

-- 4. Години, коли біля стійки хтось є. Порівняти з «Дохід за годиною дня»:
--    розбіжність між підходами й чеками показує, коли ми втрачаємо людей.
select extract(hour from started_at at time zone 'Europe/Kyiv') as hour,
       count(*) filter (where kind = 'approach') as approaches,
       count(*) filter (where kind = 'queue') as queues
  from video_events
 where point_id = $1 and started_at >= $2 and started_at < $3
 group by 1
 order by 1;

-- 5. Черга: скільки разів і як надовго зʼявлялось двоє й більше. Плюс
--    підходи, що припали на чергу й не дали чека, — найближче до «пішов,
--    бо не хотів чекати», що взагалі можна дістати з відео.
with q as (
  select started_at, ended_at, (meta->>'max_people')::int as people
    from video_events
   where kind = 'queue' and point_id = $1
     and started_at >= $2 and started_at < $3)
select count(*) as queues,
       max(people) as max_people,
       round(avg(extract(epoch from (ended_at - started_at)))::numeric, 1) as avg_s,
       (select count(*) from video_events a
         where a.kind = 'approach' and a.point_id = $1
           and a.likely_receipt_id is null
           and exists (select 1 from q
                        where a.started_at < q.ended_at
                          and a.ended_at > q.started_at)) as left_in_queue
  from q;

-- 6. Здоровʼя черги для overseer: вік найстарішого необробленого сегмента.
--    Lifecycle R2 зносить відео через 7 діб і не питає, чи ми встигли, тому
--    поріг тривоги — 3 доби (docs/video.md).
select count(*) filter (where status in ('pending', 'failed')) as backlog,
       count(*) filter (where status = 'expired') as lost,
       round(extract(epoch from now() - min(started_at)
             filter (where status in ('pending', 'failed'))) / 3600.0, 1) as oldest_h
  from video_segments;
