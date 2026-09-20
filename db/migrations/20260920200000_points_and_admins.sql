-- migrate:up

-- citext: нікнейми й пошта звіряються без урахування регістру (db-schema §1).
create extension if not exists citext;

-- Точка. Текстовий ключ із першого дня: він їде в URL меню й у ключі R2,
-- тому формат зафіксовано перевіркою, а не домовленістю (docs/urls.md).
create table points (
    id                 text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
    name               text        not null,
    address            text,
    timezone           text        not null default 'Europe/Kyiv',
    status             text        not null default 'planned'
                                   check (status in ('planned', 'live', 'paused')),
    -- філія в Checkbox: через неї ціна саме цієї точки (docs/checkbox.md)
    checkbox_branch_id text,
    -- ключ малини: у базі лише sha256, сам ключ у config/point.key
    key_hash           text,
    next_key_hash      text,
    key_rotated_at     timestamptz,
    key_revoked_at     timestamptz,
    last_seen_at       timestamptz,
    created_at         timestamptz not null default now()
);

-- Адміни. Пароль - scrypt у PHC-рядку; null означає, що рядок є, а входу
-- ще немає. Рядок не видаляють, а гасять disabled_at (docs/services.md §3).
create table admin_users (
    id              uuid primary key default gen_random_uuid(),
    email           citext not null unique,
    role            text   not null check (role in ('owner', 'ops')),
    password_hash   text,
    password_set_at timestamptz,
    disabled_at     timestamptz,
    last_login_at   timestamptz,
    created_at      timestamptz not null default now()
);

-- migrate:down
drop table admin_users;
drop table points;
