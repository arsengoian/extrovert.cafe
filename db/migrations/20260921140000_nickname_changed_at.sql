-- migrate:up

-- Коли гравець востаннє міняв нікнейм сам: попап «Змінити нікнейм»
-- обіцяє «раз на 30 днів», і api це перевіряє. Нікнейм, обраний на
-- першому вході, зміною не вважається — тому колонка порожня, доки
-- гравець не змінить його з профілю.
alter table users add column nickname_changed_at timestamptz;

comment on column users.nickname_changed_at is 'Остання зміна нікнейма з профілю; наступна — не раніше ніж за 30 днів';

-- migrate:down
alter table users drop column nickname_changed_at;
