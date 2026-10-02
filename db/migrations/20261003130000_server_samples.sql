-- migrate:up

-- Телеметрія самого сервера для адмінки (docs/admin_panel.md, «Сервер»):
-- процесор, памʼять, диск, бази й контейнери. Проби до 03.10.2026 відповідали
-- лише на «живий / ні»; а те, що дроплет на одному ядрі й двох гігабайтах
-- поволі впирається в стелю, видно тільки з чисел у часі.
--
-- Проба — раз на дві хвилини від overseer, рядок на пробу без відер: числа,
-- на відміну від «так / ні» в health_samples, адмінка усереднює сама під
-- крок періоду (date_bin). Місяць — 22 тисячі рядків, близько десятка
-- мегабайтів разом із контейнерами; старше затирає сам overseer.
create table server_samples (
    taken_at    timestamptz primary key default now(),
    -- Завантаження процесора за дві хвилини від попередньої проби (а не
    -- миттєве): саме середнє каже, чи бракує ядра. null — перша проба після
    -- перезапуску overseer, рахувати ще нема від чого.
    cpu_pct     real,
    cpus        smallint,
    load1       real,
    -- Зайнята памʼять — MemTotal − MemAvailable: кеш сторінок ядро віддає на
    -- першу вимогу, і рахувати його зайнятим означало б вічні 90 %.
    mem_used    bigint,
    mem_total   bigint,
    swap_used   bigint,
    -- Як у df: зарезервовані для root блоки доступними не рахуються.
    disk_used   bigint,
    disk_total  bigint,
    -- {назва бази: байти} — наша й glitchtip, що росте сама по собі.
    databases   jsonb not null default '{}',
    redis_bytes bigint,
    -- {сервіс compose: {cpu, mem, restarts}}; копії одного сервісу (api
    -- під час викочування) складені разом. Подробиці останньої проби
    -- (стан, аптайм, образ) — у Redis, server:containers.
    containers  jsonb not null default '{}'
);

-- migrate:down

drop table server_samples;
