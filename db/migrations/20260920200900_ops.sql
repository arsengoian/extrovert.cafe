-- migrate:up

-- Відео: сегменти в черзі через SKIP LOCKED (video.md).
create table video_segments (
    id           bigserial primary key,
    point_id     text not null references points (id),
    camera_id    text not null,
    r2_key       text not null unique,             -- ідемпотентність заливки
    started_at   timestamptz not null,
    duration_ms  int,
    bytes        bigint,
    status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'done', 'failed', 'expired')),
    attempts     smallint not null default 0,
    locked_at    timestamptz,
    processed_at timestamptz,
    error        text
);

create index on video_segments (started_at) where status in ('pending', 'failed');
create index on video_segments (point_id, started_at desc);

-- Події: likely_receipt_id саме ймовірний - зведено за часом, не з обличчя.
create table video_events (
    id                bigserial primary key,
    point_id          text not null references points (id),
    kind              text not null check (kind in ('approach', 'queue', 'idle')),
    started_at        timestamptz not null,
    ended_at          timestamptz,
    segment_id        bigint references video_segments (id) on delete set null,
    likely_receipt_id bigint references receipts (id) on delete set null,
    evidence          jsonb,                       -- ключі кадрів і кліпа в R2
    meta              jsonb not null default '{}'::jsonb
);

create index on video_events (point_id, started_at desc);
create index on video_events using gin (meta jsonb_path_ops);

alter table redemptions
    add constraint redemptions_evidence_event_id_fkey
    foreign key (evidence_event_id) references video_events (id) on delete set null;

-- Здоровʼя: одразу півгодинними відрами, сирих проб не зберігаємо.
create table health_samples (
    id           bigserial primary key,
    target       text not null,
    bucket_start timestamptz not null,
    ok           boolean not null,
    detail       text,
    samples      int not null default 1,
    unique (target, bucket_start)
);

create index on health_samples (bucket_start desc);

create table problem_reports (
    id           bigserial primary key,
    user_id      uuid references users (id) on delete set null,
    point_id     text references points (id),
    categories   text[] not null default '{}',
    body         text,
    image_r2_key text,
    status       text not null default 'new' check (status in ('new', 'read', 'closed')),
    created_at   timestamptz not null default now()
);

create index on problem_reports (status, created_at desc);

create table news_broadcasts (
    id         bigserial primary key,
    created_by uuid references admin_users (id),
    title      text not null,
    body       text not null,
    audience   text,
    sent_at    timestamptz
);

-- Пошта для подій: рядок пишеться в тій самій транзакції, що й зміна.
create table outbox (
    id           bigserial primary key,
    channel      text  not null,
    event        text  not null,
    payload      jsonb not null,
    created_at   timestamptz not null default now(),
    published_at timestamptz,
    attempts     smallint not null default 0
);

create index on outbox (id) where published_at is null;

-- Де зупинилось кожне фонове забирання.
create table sync_cursors (
    name       text primary key,
    cursor_at  timestamptz,
    run_at     timestamptz,
    last_error text
);

-- Підтримка: один чат у Telegram - один тред.
create table support_threads (
    id                bigserial primary key,
    telegram_chat_id  text not null unique,
    user_id           uuid references users (id) on delete set null,
    telegram_username text,
    status            text not null default 'open' check (status in ('open', 'closed')),
    last_user_at      timestamptz,
    last_admin_at     timestamptz,
    created_at        timestamptz not null default now()
);

create index on support_threads (status, last_user_at desc);

create table support_messages (
    id                 bigserial primary key,
    thread_id          bigint not null references support_threads (id) on delete cascade,
    direction          text   not null check (direction in ('in', 'out')),
    telegram_update_id bigint unique,              -- ідемпотентність вебхука
    telegram_message_id bigint,
    body               text,
    attachments        jsonb,
    admin_id           uuid references admin_users (id),
    created_at         timestamptz not null default now()
);

create index on support_messages (thread_id, created_at);

-- migrate:down
drop table support_messages;
drop table support_threads;
drop table sync_cursors;
drop table outbox;
drop table news_broadcasts;
drop table problem_reports;
drop table health_samples;
alter table redemptions drop constraint redemptions_evidence_event_id_fkey;
drop table video_events;
drop table video_segments;
