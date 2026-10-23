-- migrate:up

-- Повернення — окремо від продажів (власник, 23.10.2026; docs/checkbox.md,
-- «Повернення»). 22.10.2026 машина зіпсувала лате (ERROR:7B00, нестача води),
-- і власник повернув гроші в Checkbox. Повернення прийшло тим самим шляхом,
-- що й продаж, і лягло в receipts як ще один чек зі знаком плюс: виручка
-- виросла на 120 ₴ замість −60, на нього створився бонус і подія кіоску,
-- відео записало людину біля автомата в «покупці», а звірка з машиною
-- побачила «чек без замовлення». Чек, що так і не фіскалізувався (CREATED),
-- теж лежав як справжній.
--
-- receipts лишаються тим, чим їх усюди й читають, — фіскалізованими
-- продажами. Повернення — тут, із посиланням на продаж (receipt_id): за
-- related_receipt_id, а коли його немає — за RRN карткової транзакції й
-- сумою (так прийшло фіскалізоване повернення з кабінету Checkbox).
create table receipt_returns (
    id bigserial primary key,
    point_id text not null references points (id),
    checkbox_receipt_id uuid not null unique,
    receipt_id bigint references receipts (id) on delete set null,
    fiscal_code text,
    fiscal_date timestamptz not null,
    total_sum numeric(12, 2) not null,
    rrn text,
    source text not null check (source in ('webhook', 'poll', 'migration')),
    raw jsonb,
    created_at timestamptz not null default now()
);
create index receipt_returns_receipt_idx on receipt_returns (receipt_id);
create index receipt_returns_date_idx on receipt_returns (fiscal_date);

insert into receipt_returns (point_id, checkbox_receipt_id, receipt_id, fiscal_code, fiscal_date, total_sum, rrn, source, raw)
select r.point_id, r.checkbox_receipt_id,
       (select o.id from receipts o
         where coalesce(o.raw ->> 'type', 'SELL') = 'SELL'
           and (o.checkbox_receipt_id::text = r.raw ->> 'related_receipt_id'
                or (o.payments -> 0 ->> 'rrn' = r.payments -> 0 ->> 'rrn' and o.total_sum = r.total_sum))
         order by o.checkbox_receipt_id::text = coalesce(r.raw ->> 'related_receipt_id', '') desc, o.fiscal_date desc
         limit 1),
       r.fiscal_code, r.fiscal_date, r.total_sum, r.payments -> 0 ->> 'rrn', 'migration', r.raw
  from receipts r
 where r.raw ->> 'type' = 'RETURN' and coalesce(r.raw ->> 'status', 'DONE') = 'DONE';

-- З receipts — усе, що не фіскалізований продаж. Бонуси й позиції таких
-- чеків ідуть каскадом (бонус за повернення — не бонус), посилання відео
-- обнуляються. Нефіскалізоване повернення (CREATED) не переносимо: це
-- спроба, яка не відбулась, а сирий запис лишається в Checkbox.
delete from receipts
 where coalesce(raw ->> 'type', 'SELL') <> 'SELL' or coalesce(raw ->> 'status', 'DONE') <> 'DONE';

-- Повернення продажу власника — теж поза статистикою, як і сам продаж.
create or replace function receipt_return_in_stats(rid bigint) returns boolean
    language sql stable
    as $$ select coalesce((select receipt_in_stats(r.receipt_id) from receipt_returns r where r.id = rid and r.receipt_id is not null), true) $$;

-- Податок — з виручки за вирахуванням повернень (повернення зменшує базу в
-- день повернення), еквайринг — з карткових продажів: комісію за
-- транзакцію банк при поверненні не віддає.
create or replace view opex_auto as
with r as (
    select r.point_id,
           (r.fiscal_date at time zone 'Europe/Kyiv')::date as day,
           r.total_sum as total,
           coalesce((select sum((p ->> 'value')::numeric) / 100
                       from jsonb_array_elements(coalesce(r.payments, '[]'::jsonb)) p
                      where p ->> 'type' = 'CASHLESS'), 0) as cashless
      from receipts r
), base as (
    select day, point_id, 'tax'::text as kind, total as base from r
    union all
    select (rr.fiscal_date at time zone 'Europe/Kyiv')::date, rr.point_id, 'tax', -rr.total_sum from receipt_returns rr
    union all
    select day, point_id, 'acquiring', cashless from r where cashless > 0
)
select b.day, b.point_id, b.kind, x.rate,
       sum(b.base)::numeric(14, 2) as base_uah,
       round(sum(b.base) * x.rate, 2) as cost_uah
  from base b
  join lateral (select o.rate from opex_rates o
                 where o.kind = b.kind and o.valid_from <= b.day
                 order by o.valid_from desc limit 1) x on true
 group by b.day, b.point_id, b.kind, x.rate;

-- migrate:down

create or replace view opex_auto as
with r as (
    select r.point_id,
           (r.fiscal_date at time zone 'Europe/Kyiv')::date as day,
           r.total_sum as total,
           coalesce((select sum((p ->> 'value')::numeric) / 100
                       from jsonb_array_elements(coalesce(r.payments, '[]'::jsonb)) p
                      where p ->> 'type' = 'CASHLESS'), 0) as cashless
      from receipts r
), base as (
    select day, point_id, 'tax'::text as kind, total as base from r
    union all
    select day, point_id, 'acquiring', cashless from r where cashless > 0
)
select b.day, b.point_id, b.kind, x.rate,
       sum(b.base)::numeric(14, 2) as base_uah,
       round(sum(b.base) * x.rate, 2) as cost_uah
  from base b
  join lateral (select o.rate from opex_rates o
                 where o.kind = b.kind and o.valid_from <= b.day
                 order by o.valid_from desc limit 1) x on true
 group by b.day, b.point_id, b.kind, x.rate;
drop function receipt_return_in_stats(bigint);
drop table receipt_returns;
