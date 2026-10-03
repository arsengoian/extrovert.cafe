-- migrate:up

-- Скарга — кілька фото (власник, 03.10.2026): кнопка «Ще фото» з дизайну
-- досі заміняла перше фото другим, бо колонка була одна. Тепер масив
-- ключів у порядку додавання; старе одиночне фото переїжджає в нього, а
-- саму колонку прибираємо, щоб не жити з двома правдами.
alter table problem_reports add column image_r2_keys text[] not null default '{}';
update problem_reports set image_r2_keys = array[image_r2_key] where image_r2_key is not null;
alter table problem_reports drop column image_r2_key;

-- Ціна з меню поруч із ціною з чека (власник, 03.10.2026). Правда — чек:
-- його price_uah пробив автомат, і саме його бачить ДПС. menu_price_uah —
-- те, що ми очікували за меню на мить чека (з урахуванням знижки в
-- кав'ярні); розходження overseer показує алертом. null — напою немає в
-- каталозі або це бонусний напій, де ціни в гривнях немає.
alter table receipt_items add column menu_price_uah numeric(10, 2);

-- migrate:down

alter table receipt_items drop column menu_price_uah;

alter table problem_reports add column image_r2_key text;
update problem_reports set image_r2_key = image_r2_keys[1] where cardinality(image_r2_keys) > 0;
alter table problem_reports drop column image_r2_keys;
