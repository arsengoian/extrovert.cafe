-- migrate:up

-- Платежі за гривні (наразі лише набори монет через mono pay).
--
-- Рядок створюється ДО оплати, разом з інвойсом: інакше після повернення з
-- платіжної сторінки ми не знали б, за що прийшли гроші. Нарахування
-- прив'язане до invoice_id, тому вебхук і опитування статусу можуть
-- прийти обидва — зарахується один раз.
create table payments (
    id           bigserial primary key,
    user_id      uuid   not null references users (id) on delete cascade,
    provider     text   not null default 'mono' check (provider in ('mono', 'test')),
    invoice_id   text   not null unique,          -- id на боці провайдера
    pack_code    text   not null,                 -- api/data/economy.json → coin_packs
    coins        int    not null check (coins > 0),
    amount_uah   numeric(10, 2) not null check (amount_uah > 0),
    status       text   not null default 'created'
                 check (status in ('created', 'processing', 'success', 'failure', 'expired', 'reversed')),
    -- нарахування робиться рівно раз; тут його слід
    ledger_entry_id bigint references ledger_entries (id),
    credited_at  timestamptz,
    raw          jsonb,                           -- остання відповідь провайдера
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index on payments (user_id, created_at desc);
create index on payments (status) where status in ('created', 'processing');

-- migrate:down
drop table payments;
