-- migrate:up

-- Анкета профіля: одна на акаунт, звідси unique на user_id.
create table quiz_profile_responses (
    id            bigserial primary key,
    user_id       uuid not null unique references users (id) on delete cascade,
    answers       jsonb not null,
    free_text     text,                            -- відкрите питання в кінці
    coins_awarded int  not null default 0 check (coins_awarded >= 0),
    created_at    timestamptz not null default now()
);

-- Квіз про напій: кредити нараховуються за мілстоунами лічильника напоїв
-- (1, 4, 10, далі кожен 10-й), пройти можна про будь-яке замовлення з
-- історії (economy §2.4). Один квіз на позицію чека.
create table quiz_drink_responses (
    id              bigserial primary key,
    user_id         uuid   not null references users (id) on delete cascade,
    receipt_item_id bigint not null unique references receipt_items (id),
    answers         jsonb  not null,
    free_text       text,
    coins_awarded   int    not null default 0 check (coins_awarded >= 0),
    created_at      timestamptz not null default now()
);

create index on quiz_drink_responses (user_id, created_at desc);

-- Репост: не частіше раз на 10 днів і не більше 5 за акаунт (economy §2.4).
-- Верифікація через унікальне посилання-редирект.
create table repost_verifications (
    id             bigserial primary key,
    user_id        uuid not null references users (id) on delete cascade,
    network        text not null,
    redirect_token text not null unique,
    clicked_at     timestamptz,
    verified_at    timestamptz,
    coins_awarded  int  not null default 0 check (coins_awarded >= 0)
);

create index on repost_verifications (user_id, verified_at desc);

-- migrate:down
drop table repost_verifications;
drop table quiz_drink_responses;
drop table quiz_profile_responses;
