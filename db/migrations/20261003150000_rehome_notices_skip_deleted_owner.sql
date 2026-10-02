-- migrate:up

-- Повне видалення гравця (delete from users — так прибирають тестові
-- акаунти) каскадом видаляє його кущі, а тригер переселення сповіщень
-- (20261003120000_rehome_notices) намагався перенести їхні системні рядки в
-- pending_notices цього ж гравця — якого вже немає. Весь delete падав на
-- зовнішньому ключі pending_notices.user_id (03.10.2026, прибирання після
-- ручного тестування). Гравця немає — переселяти нікуди: рядки чату
-- зникають разом із кущем, як і решта його даних.
create or replace function rehome_notices(p_plant uuid, p_owner uuid) returns void
language plpgsql as $$
declare
  target uuid;
begin
  if p_owner is null or not exists (select 1 from users where id = p_owner) then
    return;
  end if;
  select id into target
    from plants
   where owner_id = p_owner and id <> p_plant
   order by chat_seen_at desc nulls last, created_at
   limit 1;
  if target is not null then
    update chat_messages set plant_id = target
     where plant_id = p_plant and user_id = p_owner and role = 'system';
  else
    insert into pending_notices (user_id, body, created_at)
    select user_id, body, created_at
      from chat_messages
     where plant_id = p_plant and user_id = p_owner and role = 'system'
     order by created_at, id;
    delete from chat_messages where plant_id = p_plant and user_id = p_owner and role = 'system';
  end if;
end $$;

-- migrate:down

create or replace function rehome_notices(p_plant uuid, p_owner uuid) returns void
language plpgsql as $$
declare
  target uuid;
begin
  if p_owner is null then
    return;
  end if;
  select id into target
    from plants
   where owner_id = p_owner and id <> p_plant
   order by chat_seen_at desc nulls last, created_at
   limit 1;
  if target is not null then
    update chat_messages set plant_id = target
     where plant_id = p_plant and user_id = p_owner and role = 'system';
  else
    insert into pending_notices (user_id, body, created_at)
    select user_id, body, created_at
      from chat_messages
     where plant_id = p_plant and user_id = p_owner and role = 'system'
     order by created_at, id;
    delete from chat_messages where plant_id = p_plant and user_id = p_owner and role = 'system';
  end if;
end $$;
