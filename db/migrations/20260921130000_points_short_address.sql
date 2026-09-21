-- migrate:up

-- Коротка адреса точки для вибору в застосунку: «Кіберклуб «Арена» ·
-- Мишуги 8» уміщується в один рядок поля, повна «вул. Миколи Мишуги, 8,
-- Київ» — ні (кадр «Повідомити про проблему»). Повна лишається для
-- документів і доставки.
alter table points add column short_address text;

comment on column points.short_address is 'Адреса для рядка вибору точки в застосунку: вулиця й будинок без міста';

-- migrate:down
alter table points drop column short_address;
