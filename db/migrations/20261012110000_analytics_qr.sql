-- migrate:up

-- Подія `qr`: застосунок відкрили з QR — наклейки на автоматі
-- (qr.extrovert.cafe?p=1) чи бонусу на кіоску (/b/<токен>?p=kyiv-01).
-- Пише api з client/src/qr.js; payload — {pos, via, platform}. Рахуємо в
-- застосунку, а не у воркері qr.*: воркер бачить і перевірку здоровʼя
-- overseer щодві хвилини, і ботів, а справжніх сканів серед них не видно
-- (власник, 12.10.2026).
alter table analytics_events drop constraint analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
    check (type in ('nav', 'api', 'qr'));

-- migrate:down

delete from analytics_events where type = 'qr';
alter table analytics_events drop constraint analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
    check (type in ('nav', 'api'));
