-- migrate:up

-- Кавенятко. Косметика цілком у appearance jsonb: рендериться цілком і
-- ніколи не питається по полю. Економіка - звичайні колонки (db-schema §0).
create table plants (
    id                        uuid primary key default gen_random_uuid(),
    owner_id                  uuid not null references users (id) on delete cascade,
    name                      text,
    growth_stage              smallint not null default 0 check (growth_stage between 0 and 10),
    face_set_id               int  not null,
    last_stage_transition_at  timestamptz,
    last_watered_at           timestamptz,
    cycle_phase               text not null default 'initial'
                              check (cycle_phase in ('initial', 'regrowth')),
    lifetime_beans_gifted     int  not null default 0 check (lifetime_beans_gifted >= 0),
    worn_set_id               bigint,
    listing_id                bigint references market_listings (id) on delete set null,
    appearance                jsonb not null default '{}'::jsonb,
    created_at                timestamptz not null default now()
);

create index on plants (owner_id, created_at);

alter table market_listings
    add constraint market_listings_plant_id_fkey
    foreign key (plant_id) references plants (id) on delete cascade;

-- Аудит переходів: що саме витратили на цей кущ і скільки це коштувало.
create table plant_stage_transitions (
    id         bigserial primary key,
    plant_id   uuid not null references plants (id) on delete cascade,
    from_stage smallint not null,
    to_stage   smallint not null,
    consumed   text not null check (consumed in ('water', 'compost', 'fertilizer', 'insecticide')),
    cost_coins int  not null default 0,
    created_at timestamptz not null default now()
);

create index on plant_stage_transitions (plant_id, created_at desc);

-- Подарований комплект: 5 слотів окремими рядками, а не пʼятьма колонками.
create table wardrobe_sets (
    id            bigserial primary key,
    plant_id      uuid not null references plants (id) on delete cascade,
    tier          text check (tier in ('common', 'uncommon', 'rare', 'epic')),
    complete      boolean not null default false,
    gifted        boolean not null default false,
    gifted_at     timestamptz,
    beans_awarded int not null default 0 check (beans_awarded >= 0)
);

create index on wardrobe_sets (plant_id);

create table wardrobe_set_items (
    id           bigserial primary key,
    set_id       bigint not null references wardrobe_sets (id) on delete cascade,
    slot         text   not null check (slot in ('head', 'body', 'pants', 'feet', 'acc_1')),
    user_item_id bigint not null references user_items (id),
    unique (set_id, slot),
    unique (user_item_id)
);

alter table plants
    add constraint plants_worn_set_id_fkey
    foreign key (worn_set_id) references wardrobe_sets (id) on delete set null;

alter table user_items
    add constraint user_items_set_id_fkey
    foreign key (set_id) references wardrobe_sets (id) on delete set null;

-- Чат із кавенятком: перші 10 повідомлень безкоштовні, далі монета за штуку.
create table chat_messages (
    id            bigserial primary key,
    plant_id      uuid not null references plants (id) on delete cascade,
    user_id       uuid not null references users (id) on delete cascade,
    role          text not null check (role in ('user', 'plant', 'system')),
    body          text not null,
    coins_charged int  not null default 0 check (coins_charged >= 0),
    tokens_in     int,
    tokens_out    int,
    created_at    timestamptz not null default now()
);

create index on chat_messages (plant_id, created_at desc);

-- migrate:down
drop table chat_messages;
alter table user_items drop constraint user_items_set_id_fkey;
alter table plants drop constraint plants_worn_set_id_fkey;
drop table wardrobe_set_items;
drop table wardrobe_sets;
drop table plant_stage_transitions;
alter table market_listings drop constraint market_listings_plant_id_fkey;
drop table plants;
