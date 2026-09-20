-- migrate:up

-- Довідник Нової Пошти: локальна копія, оновлюється щоночі (services.md §4).
create table np_cities (
    ref             text primary key,
    name            text not null,
    area            text,
    settlement_type text,
    synced_at       timestamptz not null default now()
);

create index on np_cities (name);

create table np_warehouses (
    ref                 text primary key,
    city_ref            text not null references np_cities (ref) on delete cascade,
    number              int,
    category            text check (category in ('branch', 'postomat')),
    type_ref            text,
    description         text,
    short_address       text,
    place_max_weight_kg int,
    dimension_limits    jsonb,
    schedule            jsonb,
    status              text,
    synced_at           timestamptz not null default now()
);

create index on np_warehouses (city_ref, category);

-- Замовлення: лише те, що фізично їде Новою Поштою (db-schema §2).
create table redemptions (
    id                 bigserial primary key,
    user_id            uuid   not null references users (id),
    ledger_entry_id    bigint not null references ledger_entries (id),
    product            text   not null,            -- id з api/data/shop-products.json
    options            jsonb  not null default '{}'::jsonb,
    cost_uah_actual    numeric(10, 2),             -- для 10% ліміту бюджету
    recipient_name     text   not null,
    recipient_phone    text   not null,
    np_warehouse_ref   text   references np_warehouses (ref),
    np_warehouse_kind  text   check (np_warehouse_kind in ('branch', 'postomat')),
    np_address_snapshot text  not null,            -- довідник міняється, замовлення ні
    np_ttn             text   unique,
    np_status_code     text,
    status             text   not null default 'new'
                       check (status in ('new', 'printing', 'packing', 'shipped',
                                         'arrived', 'received', 'returned', 'cancelled')),
    status_changed_at  timestamptz not null default now(),
    user_seen_at       timestamptz,                -- лічильник непереглянутих змін
    evidence_event_id  bigint,                     -- FK додається разом із video_events
    created_at         timestamptz not null default now()
);

create index on redemptions (user_id, created_at desc);
create index on redemptions (status) where status not in ('received', 'cancelled', 'returned');

create table redemption_events (
    id            bigserial primary key,
    redemption_id bigint not null references redemptions (id) on delete cascade,
    status        text   not null,
    source        text   not null check (source in ('admin', 'np', 'system')),
    note          text,
    created_at    timestamptz not null default now()
);

create index on redemption_events (redemption_id, created_at desc);

-- Знижка на POS: код живе в журналі, а не в замовленнях.
create table pos_discount_codes (
    id              bigserial primary key,
    ledger_entry_id bigint not null references ledger_entries (id),
    user_id         uuid   not null references users (id),
    code            text   not null unique,
    amount_uah      numeric(10, 2) not null check (amount_uah > 0),
    issued_at       timestamptz not null default now(),
    used_at         timestamptz,
    receipt_id      bigint references receipts (id)
);

create index on pos_discount_codes (user_id, issued_at desc);

-- migrate:down
drop table pos_discount_codes;
drop table redemption_events;
drop table redemptions;
drop table np_warehouses;
drop table np_cities;
