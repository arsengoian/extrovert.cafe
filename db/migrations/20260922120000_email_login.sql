-- migrate:up

-- Вхід посиланням із пошти замість Apple (22.09.2026). Apple вимагає
-- платного Apple Developer Program ($99 на рік) навіть для вебу, а нам він
-- не потрібен: у App Store нас немає. Жодного рядка з 'apple' не існувало —
-- вхід через Apple так і не був написаний.
alter table user_identities drop constraint user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
    check (provider in ('google', 'email'));

-- Одноразові посилання для входу. Сам токен є лише в листі, тут — його
-- sha256: дамп таблиці не має відкривати чужі акаунти. Рядок живе добу
-- (прибирає сам роут), цього вистачає для лімітів «лист на хвилину» й
-- розбору скарг «не приходить лист».
create table login_links (
    token_hash  bytea primary key,
    email       citext not null,
    next_path   text,                            -- куди повернути після входу: /b/<токен> бонусу з кіоска
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz,                     -- одноразове: перше відкриття гасить
    ip          inet,
    user_agent  text
);
create index login_links_email_created_idx on login_links (email, created_at);
create index login_links_ip_created_idx on login_links (ip, created_at);
create index login_links_created_idx on login_links (created_at);

comment on table login_links is 'Одноразові посилання для входу поштою (хеш токена, 15 хвилин)';

-- migrate:down
drop table login_links;
alter table user_identities drop constraint user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
    check (provider in ('google', 'apple'));
