-- migrate:up

-- Дозволи на перезавантаження малини сторожу SD-картки (bin/telemetry
-- --sdwatch, docs/raspberry-pi.md, «Сторож картки»). Ліміт на добу живе
-- тут, а не на малині: лічильник на картці, яка вмерла й не пише, не росте,
-- і ребут став би вічним (власник, 17.10.2026). Кожен запит — рядок: і
-- дозвіл, і відмова, щоб у разі чого було видно, скільки разів точка
-- просилась. test — перевірка ланцюжка без ребуту (SIGUSR1 сторожу), у
-- ліміт не йде.
create table point_reboots (
    id bigserial primary key,
    point_id text not null references points (id),
    boot_id text,
    reason text,
    test boolean not null default false,
    granted boolean not null,
    requested_at timestamptz not null default now()
);
create index point_reboots_point_idx on point_reboots (point_id, requested_at desc);

-- migrate:down

drop table point_reboots;
