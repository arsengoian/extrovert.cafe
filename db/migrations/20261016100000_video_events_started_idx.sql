-- migrate:up transaction:false

-- Події за період без точки (адмінка «Події», 16.10.2026): список і
-- лічильники типів фільтрують за started_at, а єдиний індекс за часом —
-- (point_id, started_at), який без точки не працює. Без цього кожна сторінка
-- переглядала б усю таблицю, а подій — тисячі на добу. Частковий — лише
-- чинні події: замінені переаналізом адмінка не показує й не рахує.
-- concurrently — щоб не тримати запис воркера, поки індекс будується;
-- у транзакції так не можна, звідси transaction:false.
create index concurrently if not exists video_events_started_at_idx
    on video_events (started_at desc) where superseded_at is null;

-- migrate:down transaction:false
drop index concurrently if exists video_events_started_at_idx;
