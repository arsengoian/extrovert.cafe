-- migrate:up

-- Ключі підпису вебхуків, які видає сам провайдер. Checkbox повертає key у
-- відповідь на реєстрацію вебхука (POST /api/v1/webhook), тож це похідне
-- значення, а не налаштування: у .env йому не місце — інакше програмі
-- довелося б писати у власний конфіг. Скрипт реєстрації кладе ключ сюди,
-- приймач вебхука читає звідси; перереєстрація міняє ключ без рестарту.
create table webhook_keys (
    provider      text primary key check (provider in ('checkbox')),
    key           text not null,
    url           text not null,                 -- куди провайдер шле вебхук
    registered_at timestamptz not null default now()
);

comment on table webhook_keys is 'Ключі підпису вебхуків, видані провайдером при реєстрації (не з .env)';

-- migrate:down
drop table webhook_keys;
