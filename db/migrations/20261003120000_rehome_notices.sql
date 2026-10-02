-- migrate:up

-- Сповіщення (системні рядки в чаті кавенятка) не мають губитися разом із
-- кавенятком (власник, 03.10.2026). Досі губились трьома шляхами:
--   * продаж і подарунок — кущ ішов до нового власника разом із чатом;
--     новий власник чужих рядків не бачить (чат фільтрується за власником),
--     а старий до куща доступу вже не має;
--   * скошування — кущ видалявся, і чат зникав каскадом.
-- Тепер сповіщення старого власника переїжджають у чат куща, що в нього
-- лишається: того, чий чат він відкривав останнім (той самий вибір, що й у
-- lib/notify.js). Якщо іншого куща немає (скошування видаляє єдиний кущ
-- перед тим, як посадити новий), — у pending_notices зі своїм часом, звідки
-- flushNotices перенесе їх у чат нового куща. Розмова з самим кавеням
-- (репліки гравця й кавенятка) лишається з кущем — це його розмова.
--
-- Тригерами, а не кодом у трьох роутах: так покриваються й майбутні шляхи
-- (передача з адмінки тощо), і забути про них не вийде.
create function rehome_notices(p_plant uuid, p_owner uuid) returns void
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

create function plants_rehome_on_owner() returns trigger
language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    perform rehome_notices(new.id, old.owner_id);
  end if;
  return new;
end $$;

create trigger plants_rehome_notices_owner
  after update of owner_id on plants
  for each row execute function plants_rehome_on_owner();

-- BEFORE, бо після видалення рядки чату вже зникли б каскадом.
create function plants_rehome_on_delete() returns trigger
language plpgsql as $$
begin
  perform rehome_notices(old.id, old.owner_id);
  return old;
end $$;

create trigger plants_rehome_notices_delete
  before delete on plants
  for each row execute function plants_rehome_on_delete();

-- Те, що вже застрягло в чатах кущів, які змінили власника, — туди ж.
do $$
declare
  r record;
begin
  for r in
    select distinct m.plant_id, m.user_id
      from chat_messages m join plants p on p.id = m.plant_id
     where m.role = 'system' and m.user_id <> p.owner_id
  loop
    perform rehome_notices(r.plant_id, r.user_id);
  end loop;
end $$;

-- migrate:down

drop trigger plants_rehome_notices_delete on plants;
drop trigger plants_rehome_notices_owner on plants;
drop function plants_rehome_on_delete();
drop function plants_rehome_on_owner();
drop function rehome_notices(uuid, uuid);
