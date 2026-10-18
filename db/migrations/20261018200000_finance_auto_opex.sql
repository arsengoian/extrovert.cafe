-- migrate:up

-- Податок і еквайринг — OPEX, який рахується сам із чеків (власник,
-- 18.10.2026; docs/stock.md, «Фінанси»). Вважаємо, що їх сплачено одразу з
-- кожного чека: окремо при сплаті податків їх не порахуєш, бо податки ФОП
-- ідуть разом з іншою діяльністю. ЄСВ сюди не входить — в управлінському
-- обліку це витрата «іншої діяльності» ФОП.
--
-- Ставка — з датою, з якої діє: зміниться комісія банку чи група ФОП —
-- новий рядок, а минулі доби лишаються за старою ставкою.
create table opex_rates (
    kind text not null check (kind in ('tax', 'acquiring')),
    valid_from date not null,
    rate numeric(6, 5) not null check (rate >= 0 and rate < 1),
    note text,
    primary key (kind, valid_from)
);

insert into opex_rates (kind, valid_from, rate, note) values
  ('tax', '2026-07-01', 0.06, 'єдиний податок 5 % + військовий збір 1 % з виручки кавʼярні'),
  ('acquiring', '2026-07-01', 0.013, 'ПриватБанк, термінал SELF2000: 1,3 %, перевірено власником 18.10.2026');

-- Автоматичний OPEX по київських добах і точках. База податку — уся сума
-- чека, еквайрингу — лише оплата карткою (payments.type = CASHLESS, суми в
-- копійках). Беремо всі чеки, і власника теж: як і собівартість його чашок,
-- податок і комісія з них — справжні гроші, хоч у виручку «Фінансів» вони
-- не йдуть (receipt_in_stats).
create view opex_auto as
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

-- migrate:down

drop view opex_auto;
drop table opex_rates;
