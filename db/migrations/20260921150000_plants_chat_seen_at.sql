-- migrate:up

-- Коли гравець востаннє відкривав чат кавенятка. Сповіщення (перекази,
-- замовлення, посадки) приходять саме в чат, тож кнопка чату на головному
-- екрані показує, скільки реплік він ще не бачив, — як у макеті.
alter table plants add column chat_seen_at timestamptz;

comment on column plants.chat_seen_at is 'Останнє відкриття чату гравцем; репліки кавенятка й системи після нього — непрочитані';

-- migrate:down
alter table plants drop column chat_seen_at;
