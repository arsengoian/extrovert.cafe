-- migrate:up

-- Невідкриті скриньки на складі (кадр «Склад»: «Щасливі скриньки · 2 ·
-- Відкрити»). Купівля й відкриття — два окремі кроки: куплена скринька
-- (за монети чи за гривні) лягає сюди, а відкривається лише зі складу.
-- Рядок на кожну скриньку, а не лічильник у users: видно, чим за неї
-- заплатили і що з неї випало.
create table user_crates (
    id           bigserial primary key,
    user_id      uuid   not null references users (id) on delete cascade,
    -- ті самі джерела, що й у crate_openings.source: відкриття їх успадковує
    source       text   not null check (source in ('coins', 'cash', 'bonus_drink')),
    -- ціна купівлі — переходить у crate_openings при відкритті
    paid_currency text  check (paid_currency in ('yellow', 'uah')),
    paid_amount  numeric(10, 2),
    -- куплена за гривні: платіж, з якого вона взялась (рівно одна на платіж)
    payment_id   bigint unique references payments (id),
    acquired_at  timestamptz not null default now(),
    opened_at    timestamptz,
    opening_id   bigint unique references crate_openings (id),
    check ((opened_at is null) = (opening_id is null))
);

create index on user_crates (user_id) where opened_at is null;

comment on table user_crates is 'Невідкриті й відкриті скриньки гравця; відкрита має opening_id';

-- Списання монет за скриньку пишеться в журнал у момент купівлі, коли
-- відкриття ще немає, — тож і посилання йде на саму скриньку.
alter table ledger_entries drop constraint ledger_entries_ref_type_check;
alter table ledger_entries add constraint ledger_entries_ref_type_check check (ref_type in (
    'receipt', 'crate_opening', 'market_trade', 'coin_transfer', 'redemption', 'user_crate'));

-- Платіж тепер може купувати не лише монети, а й скриньку.
alter table payments add column product text not null default 'coins'
    check (product in ('coins', 'crate'));
alter table payments drop constraint payments_coins_check;
alter table payments add constraint payments_coins_check check (coins >= 0);

comment on column payments.product is 'Що куплено: coins — набір монет (pack_code з coin_packs), crate — скринька на склад (coins = 0)';

-- migrate:down
alter table ledger_entries drop constraint ledger_entries_ref_type_check;
alter table ledger_entries add constraint ledger_entries_ref_type_check check (ref_type in (
    'receipt', 'crate_opening', 'market_trade', 'coin_transfer', 'redemption'));
alter table payments drop constraint payments_coins_check;
alter table payments add constraint payments_coins_check check (coins > 0);
alter table payments drop column product;
drop table user_crates;
