-- migrate:up

-- P2P-маркет: один фід на одяг і кавенят, вхід у нього різний (ui, Магазин).
create table market_listings (
    id             bigserial primary key,
    seller_id      uuid   not null references users (id) on delete cascade,
    kind           text   not null check (kind in ('item', 'plant')),
    user_item_id   bigint references user_items (id),
    plant_id       uuid,
    price_amount   int    not null check (price_amount > 0),
    price_currency text   not null check (price_currency in ('yellow', 'beans')),
    commission_pct numeric(5, 2) not null,
    status         text   not null default 'active'
                   check (status in ('active', 'sold', 'cancelled')),
    -- покази: скільки разів API запропонував лот; з Redis раз на хвилину
    impressions    int    not null default 0 check (impressions >= 0),
    created_at     timestamptz not null default now(),
    check ((kind = 'item' and user_item_id is not null and plant_id is null)
        or (kind = 'plant' and plant_id is not null and user_item_id is null))
);

create unique index on market_listings (user_item_id) where status = 'active' and user_item_id is not null;
create unique index on market_listings (plant_id) where status = 'active' and plant_id is not null;
create index on market_listings (kind, seller_id) where status = 'active';

alter table user_items
    add constraint user_items_listing_id_fkey
    foreign key (listing_id) references market_listings (id) on delete set null;

create table market_trades (
    id         bigserial primary key,
    listing_id bigint not null unique references market_listings (id),
    buyer_id   uuid   not null references users (id),
    seller_id  uuid   not null references users (id),
    gross      int    not null check (gross > 0),
    commission int    not null check (commission >= 0),
    net        int    not null check (net >= 0),
    currency   text   not null check (currency in ('yellow', 'beans')),
    created_at timestamptz not null default now(),
    check (net + commission = gross),
    check (buyer_id <> seller_id)
);

create index on market_trades (buyer_id, created_at desc);
create index on market_trades (seller_id, created_at desc);

-- Переказ монет: тільки жовті, тому колонки валюти тут немає взагалі -
-- переказ срібних стає неможливим станом, а не забутою валідацією.
create table coin_transfers (
    id         bigserial primary key,
    from_user  uuid not null references users (id),
    to_user    uuid not null references users (id),
    amount     int  not null check (amount > 0),
    created_at timestamptz not null default now(),
    check (from_user <> to_user)
);

create index on coin_transfers (from_user, created_at desc);
create index on coin_transfers (to_user, created_at desc);

-- migrate:down
drop table coin_transfers;
drop table market_trades;
alter table user_items drop constraint user_items_listing_id_fkey;
drop table market_listings;
