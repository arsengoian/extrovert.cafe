-- migrate:up

-- Знижка в кав'ярні — черга на точці (власник, 28.09.2026). Досі кожна
-- купівля ставила два деплойменти цін із наперед розрахованим кінцем. Тепер
-- правил більше, ніж влазить у два рядки черги деплойментів:
--   * знижка закінчується за часом (window_s) АБО першим чеком із точки —
--     що настане раніше;
--   * друга знижка на ту саму точку стає в чергу за першою, а не зливається;
--   * якщо знижене меню так і не доїхало (ціль деплою failed — заливка чи
--     кіоск не підтвердив), зерна повертаються самі, з попапом у застосунку.
-- Тому кожна знижка — рядок зі станом, а деплойменти цін лише наслідок:
-- знижений — коли знижка стає активною, звичайний — коли вона скінчилась, а
-- в черзі нікого (backend/lib/src/discounts.js).
create table point_discounts (
    id              bigserial primary key,
    point_id        text   not null references points (id),
    user_id         uuid   references users (id),            -- null — тестова з адмінки
    ledger_entry_id bigint references ledger_entries (id),   -- списання зерен; за ним і повертаємо
    uah             integer not null check (uah > 0),
    window_s        integer not null check (window_s > 0),
    status          text   not null default 'queued'
                    check (status in ('queued', 'active', 'done', 'refunded')),
    ended_reason    text   check (ended_reason in ('time', 'receipt', 'failed')),
    deployment_id   bigint references menu_deployments (id), -- знижене меню цієї знижки
    created_at      timestamptz not null default now(),
    started_at      timestamptz,
    ends_at         timestamptz,
    ended_at        timestamptz
);

create index on point_discounts (point_id, status, id);
-- Активна на точці — щонайбільше одна: друга чекає в черзі.
create unique index point_discounts_one_active on point_discounts (point_id) where status = 'active';

-- migrate:down

drop table point_discounts;
