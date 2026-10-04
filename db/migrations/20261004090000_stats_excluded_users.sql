-- migrate:up

-- Акаунти поза статистикою (власник, 04.10.2026): свої й тестові акаунти
-- живуть на проді поруч зі справжніми гравцями, але не мають впливати на
-- жоден дашборд — ні аналітику застосунку, ні дашборд статистики, ні квізи,
-- ні лічильники гравців, ні щоденний звіт в overseer. Дані акаунта не
-- чіпаємо: прапорець лише прибирає його з підрахунків, і зняти його можна
-- будь-коли — статистика перерахується разом із минулим.
alter table users add column stats_excluded boolean not null default false;

-- Одна умова на всі запити статистики: null — гість чи бонус, який ніхто
-- не забрав, і вони рахуються як завжди.
create function in_stats(uid uuid) returns boolean
  language sql stable
  as $$ select uid is null or not exists (select 1 from users where id = uid and stats_excluded) $$;

-- Чек, бонус із якого забрав такий акаунт, — це його ж тестова покупка:
-- з виручки, бонусів і чеків у статистиці він теж зникає. Сам чек у
-- списку покупок і в Checkbox лишається як є.
create function receipt_in_stats(rid bigint) returns boolean
  language sql stable
  as $$ select not exists (select 1 from bonus_grants b where b.receipt_id = rid and not in_stats(b.redeemed_by)) $$;

-- migrate:down

drop function receipt_in_stats(bigint);
drop function in_stats(uuid);
alter table users drop column stats_excluded;
