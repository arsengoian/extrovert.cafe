-- Бонусність напою — прапорець, а не число (рішення власника 23.09.2026).
--
-- Було дві колонки: `coins` — скільки монет напій ДАЄ, `bonus_coins` —
-- скільки монет він КОШТУЄ, якщо це бонусна позиція. Друга колонка тягла
-- два сенси одразу («це бонус» і «ціна»), а її значення до того ж дублювало
-- price_uah (economy §7.1: coins_bonus = price_uah).
--
-- Тепер число одне — `coins`, і читається воно за прапорцем: у звичайного
-- напою це заробіток, у бонусного — ціна.

-- migrate:up
alter table drinks add column is_bonus boolean not null default false;
update drinks set is_bonus = true, coins = bonus_coins where bonus_coins > 0;
alter table drinks drop column bonus_coins;

-- migrate:down
alter table drinks add column bonus_coins int not null default 0 check (bonus_coins >= 0);
update drinks set bonus_coins = coins, coins = 0 where is_bonus;
alter table drinks drop column is_bonus;
