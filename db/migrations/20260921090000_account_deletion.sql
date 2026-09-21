-- migrate:up

-- Видалення акаунта: рядок лишається, людина зникає.
--
-- Гравець має змогу піти, але вся аналітика по покупках, економіці й
-- маркету будується на історії — фізичне видалення рядка знесло б і чужі
-- угоди, і статистику точки. Тому стираємо те, що вказує на людину
-- (пошта), і позначаємо акаунт видаленим; нікнейм звільняється під новий
-- вигляд deleted_account_<n>, а старий лишається в deleted_nickname —
-- інакше в підтримці неможливо звести скаргу з акаунтом.
alter table users
    add column deleted_at       timestamptz,
    add column deleted_nickname citext;

-- Часткові індекси: живих акаунтів завжди більше, і кожен запит про них
-- («знайти за нікнеймом», «кому переказати») не має читати видалені.
create index on users (deleted_at) where deleted_at is not null;

-- migrate:down
drop index users_deleted_at_idx;
alter table users
    drop column deleted_at,
    drop column deleted_nickname;
