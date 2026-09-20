-- migrate:up

-- Словник для автогенерації нікнеймів: «прикметник_кавове_слово».
-- Прикметник має узгоджуватись із родом іменника, інакше виходить
-- «бадьорий арабіка» — тому форми лежать поруч зі словом, а не
-- вгадуються в коді.
create table nickname_words (
    id     bigserial primary key,
    kind   text    not null check (kind in ('adjective', 'noun')),
    word   text    not null unique,        -- прикметник у чоловічому роді
    forms  jsonb,                          -- прикметник: {"m":…, "f":…, "n":…}
    gender text    check (gender in ('m', 'f', 'n')),   -- іменник
    active boolean not null default true,
    -- прикметник без форм і іменник без роду зібрати нікнейм не дадуть
    check ((kind = 'adjective' and forms is not null)
        or (kind = 'noun' and gender is not null))
);

create index on nickname_words (kind) where active;

-- migrate:down
drop table nickname_words;
