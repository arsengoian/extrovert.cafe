-- migrate:up

-- Знижка на POS — не код, а тимчасова ціна на обраній точці (власник,
-- 27.09.2026): у чергу стають два деплойменти цін для цієї точки —
-- спершу знижений на 20 ₴, потім звичайний. Код, який треба кудись
-- вводити, з'явився помилкою на етапі дизайну бази: на автоматі його
-- нікуди ввести, і ніщо його не погашало (used_at ніхто не писав).
--
-- Запис про саму покупку лишається в журналі (ledger_entries, reason
-- 'pos_discount', meta.uah) — таблиця кодів нічого, крім коду, не додавала.
-- На проді в ній один рядок — тестова покупка власника того ж дня.
drop table pos_discount_codes;

-- migrate:down

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
