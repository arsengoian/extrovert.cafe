-- migrate:up

-- Чеки з ПРРО. Ідемпотентність по checkbox_receipt_id: вебхук і опитування
-- приносять той самий чек, другий запис має тихо нічого не зробити.
create table receipts (
    id                  bigserial primary key,
    point_id            text not null references points (id),
    checkbox_receipt_id uuid not null unique,
    checkbox_shift_id   uuid,
    fiscal_code         text,
    fiscal_date         timestamptz not null,
    total_sum           numeric(12, 2) not null,
    payments            jsonb,
    tax_url             text,
    source              text not null check (source in ('webhook', 'poll')),
    raw                 jsonb,
    created_at          timestamptz not null default now()
);

create index on receipts (point_id, fiscal_date desc);
create index on receipts (fiscal_date desc);

create table receipt_items (
    id             bigserial primary key,
    receipt_id     bigint not null references receipts (id) on delete cascade,
    system_code    text   not null,
    name           text   not null,
    qty            numeric(10, 3) not null,
    price_uah      numeric(10, 2) not null,
    sum_uah        numeric(12, 2) not null,
    is_bonus_drink boolean not null default false
);

create index on receipt_items (receipt_id);
create index on receipt_items (system_code);

-- Бонус за чек: три стани, бо між ними користувач може закрити вкладку.
-- Один чек - одне нарахування, звідси unique на receipt_id.
create table bonus_grants (
    id           bigserial primary key,
    receipt_id   bigint not null unique references receipts (id) on delete cascade,
    point_id     text   not null references points (id),
    coins_yellow int    not null default 0 check (coins_yellow >= 0),
    items        jsonb,                            -- лутдроп, якщо випав
    claim_token  text   not null unique,           -- у QR на екрані кіоска
    expires_at   timestamptz not null,             -- 2 хв (gamification_ui.md)
    claimed_at   timestamptz,                      -- забрали на пристрій
    redeemed_by  uuid references users (id),
    redeemed_at  timestamptz,                      -- зарахували в акаунт
    status       text   not null default 'pending'
                 check (status in ('pending', 'claimed', 'redeemed', 'expired'))
);

create index on bonus_grants (status, expires_at) where status in ('pending', 'claimed');
create index on bonus_grants (redeemed_by, redeemed_at desc);

-- Телеметрія точки. idem_key: малина ретраїть зі збереженим ключем.
create table device_telemetry (
    id          bigserial primary key,
    point_id    text not null references points (id),
    source      text not null check (source in ('pi', 'jetinno', 'camera')),
    idem_key    text not null unique,
    measured_at timestamptz not null,
    metrics     jsonb not null,
    received_at timestamptz not null default now()
);

create index on device_telemetry (point_id, measured_at desc);

-- migrate:down
drop table device_telemetry;
drop table bonus_grants;
drop table receipt_items;
drop table receipts;
