-- Сповіщення для гравця, у якого зараз немає жодного кавенятка.
--
-- Єдиний канал сповіщень — системна репліка в чаті кавенятка (notify.js), а
-- чат живе при кущі. Гравець без куща буває частіше, ніж здається: скосив,
-- подарував, продав на ринку останнє — і між цим моментом і новим саджанцем
-- минають хвилини або дні. Досі `notifyPlant` у цьому випадку просто
-- виходив, тобто «твою річ продано, +140» зникало назавжди й мовчки.
--
-- Тут воно чекає, поки зʼявиться кущ, і тоді лягає в його чат першими
-- рядками (notify.js, flushNotices).

-- migrate:up
create table pending_notices (
    id         bigserial primary key,
    user_id    uuid        not null references users (id) on delete cascade,
    body       text        not null,
    created_at timestamptz not null default now()
);

comment on table pending_notices is
    'Сповіщення, які нікуди покласти: у гравця немає кавенятка. Переїжджають у чат першого ж куща';

create index on pending_notices (user_id, id);

-- migrate:down
drop table pending_notices;
