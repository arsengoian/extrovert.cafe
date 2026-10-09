-- migrate:up

-- Замовлення кавомашини з порталу Jetinno для звірки з чеками Checkbox
-- (docs/jetinno.md, «Замовлення машини для звірки»). Наш журнал продажів —
-- це receipts (чеки); тут лежить те, що звітує сама машина, щоб бачити
-- розбіжності: карткове замовлення без чека й навпаки. Готівкове теж мало б
-- фіскалізуватись, тож «готівка без чека» — не норма, а сигнал (власник,
-- 09.10.2026), просто поки не на часі.
--
-- order_no — номер замовлення Jetinno (час + vmc + випадкові цифри),
-- унікальний на точку: повторне зняття того самого вікна не плодить копій.
create table machine_orders (
    id           bigserial primary key,
    point_id     text        not null references points (id),
    order_no     text        not null,
    product_id   integer,
    price_uah    numeric(10,2),
    pay_type     text,                              -- mdb_cashless | mdb_cash | test
    status       text,
    purchased_at timestamptz,                       -- «час покупки» (годинник машини)
    uploaded_at  timestamptz,                       -- «час завантаження» в портал
    raw          jsonb,
    created_at   timestamptz not null default now(),
    unique (point_id, order_no)
);

create index on machine_orders (point_id, purchased_at);

-- migrate:down

drop table machine_orders;
