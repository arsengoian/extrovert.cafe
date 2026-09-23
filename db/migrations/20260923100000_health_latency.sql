-- Затримка відповіді сервіса. У макеті дашборда здоровʼя біля кожного
-- рядка стоїть «128 мс», а проби писали лише «відповів / не відповів»
-- (questions.md, питання 2 — власник попросив додати 23.09.2026).
--
-- Зберігаємо суму й кількість, а не готове середнє: у півгодинне відро
-- лягає кілька проб, і середнє з середніх брехало б тим більше, чим
-- нерівномірніше вони йдуть.

-- migrate:up
alter table health_samples
    add column ms_total bigint not null default 0,
    add column ms_count int    not null default 0;

-- migrate:down
alter table health_samples drop column ms_total, drop column ms_count;
