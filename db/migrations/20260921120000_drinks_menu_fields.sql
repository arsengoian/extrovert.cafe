-- migrate:up

-- Каталог напоїв стає єдиним джерелом правди для меню кіоска.
--
-- Досі напої жили у двох місцях: таблиця `drinks` знала ціну й монети, а
-- файл pos/data/prices.json — те саме плюс колір картки й наявність піни.
-- Два списки з однаковими напоями розходяться не «якщо», а «коли»: ціну
-- міняють в одному місці, кіоск показує інше, а каса — третє.
--
-- Тому два поля, яких таблиці бракувало, переїжджають сюди, і меню
-- будується з бази (pos/scripts/push-prices.mjs).
alter table drinks
    add column color text,
    add column foam  boolean not null default false;

comment on column drinks.color is 'Колір картки в меню кіоска, #rrggbb — картка малюється ним, а не картинкою';
comment on column drinks.foam is 'Напій із піною: кіоск малює шапку на стакані';

-- migrate:down

alter table drinks
    drop column color,
    drop column foam;
