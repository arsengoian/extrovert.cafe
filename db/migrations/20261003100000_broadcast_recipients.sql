-- migrate:up

-- Розсилки новин з адмінки в чат кавенятка (gamification_ui.md,
-- «Сповіщення»; власник, 03.10.2026). Таблиця news_broadcasts була від
-- початку, а відправки не було. recipients — скільки гравців отримали
-- рядок: у списку розсилок видно, до кого вона дійшла.
alter table news_broadcasts add column recipients int;

-- migrate:down

alter table news_broadcasts drop column recipients;
