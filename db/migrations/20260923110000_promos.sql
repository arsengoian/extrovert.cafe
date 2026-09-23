-- Бібліотека акцій для адмінки (questions.md, питання 7).
--
-- Раніше текст акції був одним полем у формі деплойменту й їхав як
-- {"text": "…"} — кіоск такого ключа не читає взагалі (menu.c бере
-- promo_label / head1 / head2 / sub / fine / sprite), тому акція просто не
-- показувалась. Тепер акція — рядок у базі з тими самими полями, що вміє
-- намалювати кіоск, а деплоймент бере її готовою.
--
-- kind — що написано на плашці; 'none' лишає панель без плашки.

-- migrate:up
create table promos (
    id          bigserial primary key,
    kind        text not null default 'promo'
                check (kind in ('promo', 'notice', 'news', 'none')),
    head1       text not null,
    head2       text not null default '',
    sub         text not null default '',
    fine        text not null default '',
    drink_code  text references drinks (system_code),
    created_at  timestamptz not null default now(),
    used_at     timestamptz,                      -- коли востаннє поїхала на точку
    archived_at timestamptz
);

create index on promos (archived_at nulls first, created_at desc);

-- migrate:down
drop table promos;
