-- Код напою розпадається на дві частини (відповіді власника 23.09.2026).
--
-- Номер позиції однаковий на всіх машинах (024 — завжди какао), а літеру
-- дає машина: перша — «a», друга — «b». Раніше в `drinks.system_code` лежав
-- склеєний код «a024», і це працювало рівно доти, доки машина одна: з
-- другої той самий напій приходив би як «b024», не знаходився й не давав
-- монет (тихо).
--
-- Тепер у напою лише номер (`slot`), а код для Checkbox, Jetinno й меню
-- збирається як `points.machine_letter || slot`.

-- migrate:up
alter table drinks rename column system_code to slot;
comment on column drinks.slot is
    'Номер позиції в машині без літери: код = points.machine_letter || slot';

-- Літеру відрізаємо лише там, де вона справді є: у сідах усі коди на «a».
update drinks set slot = substring(slot from 2) where slot ~ '^[a-z][0-9]+$';

-- migrate:down
update drinks set slot = 'a' || slot where slot ~ '^[0-9]+$';
alter table drinks rename column slot to system_code;
