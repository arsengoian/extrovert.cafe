-- migrate:up

-- Подія `pass` замість `idle` (власник, 12.10.2026). Питання до відео —
-- який відсоток тих, хто проходить повз кавʼярню, до неї підходить; для
-- цього потрібні самі перехожі, а не хвилини, коли біля стійки порожньо.
-- `idle` нічого не додавав: порожнеча — це просто відсутність подій, і
-- зберігати її рядками (ще й з кадром-доказом) сенсу немає.
--
-- Рядки `idle` видаляємо разом із типом. redemptions.evidence_event_id
-- посилається на події з ON DELETE SET NULL, але на простій ніхто й не
-- посилався б: доказом викупу буває лише підхід.
delete from video_events where kind = 'idle';
alter table video_events drop constraint video_events_kind_check;
alter table video_events add constraint video_events_kind_check
    check (kind in ('approach', 'queue', 'pass'));

-- migrate:down

delete from video_events where kind = 'pass';
alter table video_events drop constraint video_events_kind_check;
alter table video_events add constraint video_events_kind_check
    check (kind in ('approach', 'queue', 'idle'));
