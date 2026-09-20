-- migrate:up

-- Гравець. Баланси - колонки тут, рухи - рядки ledger_entries (§0).
-- Інвентар догляду теж тут, а не в кавенятка: кущів багато, відро одне.
create table users (
    id                  uuid primary key default gen_random_uuid(),
    nickname            citext not null unique,
    email               citext,
    coins_yellow        int    not null default 0 check (coins_yellow >= 0),
    coins_silver        int    not null default 0 check (coins_silver >= 0),
    beans               int    not null default 0 check (beans >= 0),
    water_liters        int    not null default 0 check (water_liters >= 0),
    compost_kg          int    not null default 0 check (compost_kg >= 0),
    fertilizer_kg       int    not null default 0 check (fertilizer_kg >= 0),
    insecticide_bottles int    not null default 0 check (insecticide_bottles >= 0),
    consent_at          timestamptz,
    terms_version       text,
    -- приховані службові змінні: qr_pos (звідки прийшов), dev (акаунт розробника)
    metadata            jsonb  not null default '{}'::jsonb,
    last_seen_at        timestamptz,
    created_at          timestamptz not null default now()
);

create index on users (email) where email is not null;

-- Вхід лише через Google/Apple, метч за email між провайдерами.
-- Унікальність саме пари: один sub може повторитись між провайдерами.
create table user_identities (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id) on delete cascade,
    provider   text not null check (provider in ('google', 'apple')),
    subject    text not null,
    created_at timestamptz not null default now(),
    unique (provider, subject)
);

create index on user_identities (user_id);

-- migrate:down
drop table user_identities;
drop table users;
