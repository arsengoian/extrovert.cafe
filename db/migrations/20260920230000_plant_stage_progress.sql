-- migrate:up

-- Перехід 0→1 вимагає трьох поливів (economy §3.2), а лічильника не було:
-- без нього два поливи й один полив виглядають для сервера однаково.
-- Скидається в нуль на кожному переході стадії.
alter table plants
    add column stage_progress smallint not null default 0 check (stage_progress >= 0);

-- migrate:down
alter table plants drop column stage_progress;
