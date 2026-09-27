-- migrate:up

-- Вхід із пошти, відкритої не в тому браузері (27.09.2026). Посилання з
-- листа Gmail відкриває у власному вікні, а на iPhone воно не ділить
-- сховище з Safari: людина «входила» всередині Gmail, а в Safari лишалась
-- поза акаунтом. Тепер вкладка, яка просила лист, чекає: посилання,
-- відкрите будь-де, підтверджує вхід, і вкладка входить сама
-- (docs/services.md §3, «Вхід гравця»).
--
-- wait_hash   — sha256 секрету, який отримала лише вкладка-прохач (як і
--               token_hash: дамп таблиці не має пускати в чужі акаунти);
-- approved_at — посилання відкрили й підтвердили («Так, це я»);
-- claimed_at  — вкладка-прохач уже забрала свою сесію: одна сесія на прохання;
-- rejected_at — «Ні, не я»: посилання згоріло, вкладка-прохач дізнається про це.
alter table login_links
    add column wait_hash   bytea,
    add column approved_at timestamptz,
    add column claimed_at  timestamptz,
    add column rejected_at timestamptz;
create unique index login_links_wait_hash_idx on login_links (wait_hash) where wait_hash is not null;

-- migrate:down
drop index if exists login_links_wait_hash_idx;
alter table login_links
    drop column rejected_at,
    drop column claimed_at,
    drop column approved_at,
    drop column wait_hash;
