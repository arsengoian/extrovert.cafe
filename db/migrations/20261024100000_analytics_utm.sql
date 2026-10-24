-- migrate:up

-- Захід за посиланням з UTM-мітками (client/src/utm.js, власник 24.10.2026):
-- Instagram веде на extrovert.cafe/?utm_source=ig&utm_medium=social&…
-- payload — мітки (source, medium, campaign, content, term), click (fb /
-- google / tiktok — лише факт кліку з реклами, без самого id) і клас
-- пристрою. В акаунт мітки пише POST /me/utm — users.metadata.utm.
alter table analytics_events drop constraint analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
    check (type in ('nav', 'api', 'qr', 'utm'));

-- migrate:down

delete from analytics_events where type = 'utm';
alter table analytics_events drop constraint analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
    check (type in ('nav', 'api', 'qr'));
