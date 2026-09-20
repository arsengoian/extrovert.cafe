-- migrate:up

-- Каталог напоїв: контентна таблиця, джерело правди - db/seeds/drinks.json.
create table drinks (
    id          bigserial primary key,
    system_code text    not null unique,          -- код у Checkbox: a033, x034
    name        text    not null,
    vol         text,
    price_uah   numeric(10, 2) not null check (price_uah >= 0),
    coins       int     not null default 0 check (coins >= 0),
    bonus_coins int     not null default 0 check (bonus_coins >= 0),
    sprite      text,
    cup         text,
    active      boolean not null default true,
    sort_order  int     not null default 0
);

create index on drinks (sort_order) where active;

-- Деплой цін: один рядок на викат, по цілі на кожну точку й канал.
create table menu_deployments (
    id           bigserial primary key,
    payload      jsonb not null,                  -- знімок цін і акцій
    status       text  not null default 'queued'
                 check (status in ('queued', 'deploying', 'done', 'partial', 'failed')),
    created_by   uuid references admin_users (id),
    scheduled_at timestamptz,
    created_at   timestamptz not null default now(),
    finished_at  timestamptz
);

-- Статус тримається на кожній цілі окремо: офлайн-малина робить деплой
-- partial, а не проваленим (db-schema §1).
create table menu_deployment_targets (
    id            bigserial primary key,
    deployment_id bigint not null references menu_deployments (id) on delete cascade,
    kind          text   not null check (kind in ('r2', 'checkbox', 'jetinno')),
    point_id      text   not null references points (id),
    status        text   not null default 'queued'
                  check (status in ('queued', 'deploying', 'done', 'failed', 'skipped')),
    done_at       timestamptz,
    acked_at      timestamptz,                    -- кіоск підтвердив, що показує
    error         text,
    unique (deployment_id, kind, point_id)
);

create index on menu_deployment_targets (status) where status in ('queued', 'deploying');

-- migrate:down
drop table menu_deployment_targets;
drop table menu_deployments;
drop table drinks;
