-- migrate:up

-- Будь-яка зміна балансів чи запасів гравця сама кладе подію в outbox, а
-- звідти вона йде вебсокетом на всі його відкриті пристрої (db-schema §0).
--
-- Чому тригер, а не enqueue() у маршрутах. Клієнт давно тримає сокет і на
-- будь-яку подію перечитує /me, а ws-сервер слухає канали user:* — але жоден
-- маршрут у канал гравця нічого не слав (перевірено 27.09.2026). Тож шапка
-- оновлювалась лише після власних дій людини: продаж її лоту, подарунок,
-- оплата з іншого пристрою до відкритого застосунку не доходили. Баланси
-- міняють із десяток маршрутів, і кожен новий забув би про подію; тригер
-- ловить усі, включно з тими, яких ще не написали, і пише подію в ТУ САМУ
-- транзакцію, що й зміну, — рівно гарантія outbox.
--
-- Поллінгу немає й не буде (рішення власника): події рівно стільки, скільки
-- змін, а не щосекунди.

create function announce_user_balance() returns trigger
language plpgsql as $$
begin
  if (new.coins_yellow, new.coins_silver, new.beans,
      new.water_liters, new.compost_kg, new.fertilizer_kg, new.insecticide_bottles)
     is distinct from
     (old.coins_yellow, old.coins_silver, old.beans,
      old.water_liters, old.compost_kg, old.fertilizer_kg, old.insecticide_bottles)
  then
    -- Числа їдуть у самій події: клієнт зараз однаково перечитує /me, але
    -- так її можна застосувати й без запиту.
    insert into outbox (channel, event, payload)
    values ('user:' || new.id, 'balance', jsonb_build_object(
      'yellow', new.coins_yellow, 'silver', new.coins_silver, 'beans', new.beans,
      'water_liters', new.water_liters, 'compost_kg', new.compost_kg,
      'fertilizer_kg', new.fertilizer_kg, 'insecticide_bottles', new.insecticide_bottles));
  end if;
  return new;
end $$;

create trigger users_announce_balance
  after update on users
  for each row execute function announce_user_balance();

-- Кавенятко перейшло до іншого власника (подарунок, продаж на ринку): обидва
-- мають побачити це одразу — одному зникає, другому з'являється.
create function announce_plant_owner() returns trigger
language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    insert into outbox (channel, event, payload)
    values ('user:' || old.owner_id, 'plants', jsonb_build_object('plant_id', new.id, 'gone', true)),
           ('user:' || new.owner_id, 'plants', jsonb_build_object('plant_id', new.id, 'gone', false));
  end if;
  return new;
end $$;

create trigger plants_announce_owner
  after update of owner_id on plants
  for each row execute function announce_plant_owner();

-- migrate:down

drop trigger if exists plants_announce_owner on plants;
drop function if exists announce_plant_owner();
drop trigger if exists users_announce_balance on users;
drop function if exists announce_user_balance();
