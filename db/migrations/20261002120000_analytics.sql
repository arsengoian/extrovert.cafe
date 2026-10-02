-- migrate:up

-- Власний збір подій застосунку гравця (власник, 02.10.2026): кожна
-- навігація на фронтенді й кожен запит до api. Пишуться не напряму сюди, а
-- в Redis-чергу (analytics:events) — щоб запит гравця не чекав на insert, —
-- і scheduler раз на хвилину переносить її пачкою (jobs/analytics.js).
--
-- Рівно те, що треба для аналітики, і нічого понад: хто (user_id, якщо
-- увійшов), звідки (ip), що (type) і мінімальний payload — для nav це
-- екран, попередній екран і клас пристрою, для api — метод, шаблон
-- маршруту без id, статус і час відповіді. Ні тіл запитів, ні рядків
-- запиту, ні user-agent. FK на users немає свідомо: insert пачками має бути
-- дешевим, а видалений акаунт лишає рядок users (з deleted_at), тож id не
-- висить у повітрі. IP видаленого акаунта затирає scheduler.
create table analytics_events (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  user_id uuid,
  ip inet,
  type text not null check (type in ('nav', 'api')),
  payload jsonb
);
create index analytics_events_at on analytics_events (at);
create index analytics_events_user_at on analytics_events (user_id, at) where user_id is not null;

-- Відра для дашборду. День — київський. dim — розріз (екран, маршрут,
-- дія…), '' — без розрізу. Тут лише те, що можна складати між днями
-- (кількості); унікальних людей за тиждень із денних не скласти — їх
-- рахує analytics_window.
create table analytics_daily (
  day date not null,
  metric text not null,
  dim text not null default '',
  value double precision not null,
  primary key (day, metric, dim)
);

-- Готові зрізи за останні 1, 7 і 30 діб: унікальні люди, сесії, воронки,
-- перцентилі — те, що з денних відер не виводиться. Перераховуються
-- цілком кожні десять хвилин.
create table analytics_window (
  days int not null,
  metric text not null,
  dim text not null default '',
  value double precision not null,
  computed_at timestamptz not null default now(),
  primary key (days, metric, dim)
);

-- migrate:down

drop table analytics_window;
drop table analytics_daily;
drop table analytics_events;
