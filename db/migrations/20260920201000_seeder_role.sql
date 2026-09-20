-- migrate:up

-- Роль, якою ходить інструмент сідів (db-schema §7). Прав на видалення в неї
-- немає навмисно: контент не видаляють, його вимикають active = false, бо
-- на нього посилаються дані гравців. У schema.sql привілеїв не видно -
-- dbmate дампить без них, тому роль живе саме в міграції (§6, правило 3).
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'seeder') then
        create role seeder nologin;
    end if;
end
$$;

grant usage on schema public to seeder;
grant select, insert, update on points, drinks, item_defs to seeder;
grant usage, select on sequence drinks_id_seq, item_defs_id_seq to seeder;

-- migrate:down
revoke usage, select on sequence drinks_id_seq, item_defs_id_seq from seeder;
revoke select, insert, update on points, drinks, item_defs from seeder;
revoke usage on schema public from seeder;
