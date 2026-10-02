-- migrate:up

-- «Кавовий ковбой Deluxe» прибирається з бази зовсім (власник, 02.10.2026).
-- Досі його 5 предметів лежали вимкненими (active = false): сід нічого не
-- видаляє, бо на item_defs посилаються речі гравців. Тепер речі гравців
-- переходять на предмет того самого слота з набору, що замінив Deluxe, —
-- «Паровий кавоман» (steampunk_*, той самий тір uncommon), і вже тоді
-- рядки Deluxe видаляються. Комплект гардероба, у якому лежала така річ,
-- лишається цілим: він посилається на user_items, а слот той самий.
--
-- Без стимпанк-набору (сід ще не накатили) замінювати нема на що — тоді
-- нічого не міняється й не видаляється рядок, на який ще є посилання.
update user_items ui
   set item_def_id = s.id
  from item_defs d
  join item_defs s on s.code = replace(d.code, 'cowboy_deluxe_', 'steampunk_')
 where ui.item_def_id = d.id
   and d.code like 'cowboy\_deluxe\_%';

delete from item_defs d
 where d.code like 'cowboy\_deluxe\_%'
   and not exists (select 1 from user_items ui where ui.item_def_id = d.id);

-- migrate:down

-- Назад не повертаємо: які саме речі були Deluxe, після заміни вже не
-- відрізнити від справжніх стимпанк-речей. Рядки каталогу, якщо знадобляться,
-- повертає сід із git-історії.
select 1;
