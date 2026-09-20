-- migrate:up

-- Журнал: один рядок - одна операція з трьома знаковими дельтами.
-- Обмін зерна на монети - ОДИН рядок, а не два (db-schema §0).
create table ledger_entries (
    id           bigserial primary key,
    user_id      uuid not null references users (id) on delete cascade,
    delta_yellow int  not null default 0,
    delta_silver int  not null default 0,
    delta_beans  int  not null default 0,
    reason       text not null check (reason in (
                     'purchase', 'quiz', 'repost', 'crate', 'care', 'chat',
                     'transfer', 'market', 'exchange', 'pos_discount',
                     'delivery', 'sapling', 'admin')),
    ref_type     text check (ref_type in (
                     'receipt', 'crate_opening', 'market_trade',
                     'coin_transfer', 'redemption')),
    ref_id       bigint,
    idem_key     text unique,
    meta         jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    check (delta_yellow <> 0 or delta_silver <> 0 or delta_beans <> 0)
);

create index on ledger_entries (user_id, created_at desc);
create index on ledger_entries (ref_type, ref_id) where ref_id is not null;

-- Каталог одягу: контент, джерело правди - db/seeds/item_defs.json.
create table item_defs (
    id             bigserial primary key,
    code           text    not null unique,
    name           text    not null,
    collection     text,
    description_md text    not null default '',
    slot           text    not null check (slot in ('head', 'body', 'pants', 'feet', 'acc_1')),
    tier           text    not null check (tier in ('common', 'uncommon', 'rare', 'epic')),
    sprite_id      text    not null,
    price_coins    int     check (price_coins > 0),
    season_id      bigint,
    active         boolean not null default true,
    check (not active or description_md <> '')
);

create index on item_defs (tier) where active;
create index on item_defs (collection);

-- Склад гравця.
create table user_items (
    id            bigserial primary key,
    user_id       uuid   not null references users (id) on delete cascade,
    item_def_id   bigint not null references item_defs (id),
    acquired_from text   not null check (acquired_from in (
                      'crate', 'drop', 'shop', 'market', 'gift', 'bonus_drink', 'admin')),
    locked        boolean not null default false,
    set_id        bigint,
    listing_id    bigint,
    acquired_at   timestamptz not null default now()
);

create index on user_items (user_id, item_def_id);
create index on user_items (user_id) where locked = false and listing_id is null;

-- Відкриття крейта: завжди і предмет, і монети (economy §4.2).
create table crate_openings (
    id             bigserial primary key,
    user_id        uuid   not null references users (id) on delete cascade,
    source         text   not null check (source in ('coins', 'cash', 'bonus_drink', 'shadow_drop')),
    paid_currency  text   check (paid_currency in ('yellow', 'uah')),
    paid_amount    numeric(10, 2),
    result_item_id bigint not null references user_items (id),
    result_coins   int    not null check (result_coins >= 0),
    was_duplicate  boolean not null default false,
    rolled_tier    text   not null check (rolled_tier in ('common', 'uncommon', 'rare', 'epic')),
    opened_at      timestamptz not null default now()
);

create index on crate_openings (user_id, opened_at desc);

-- migrate:down
drop table crate_openings;
drop table user_items;
drop table item_defs;
drop table ledger_entries;
