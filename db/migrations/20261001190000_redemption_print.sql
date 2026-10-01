-- migrate:up

-- Чашка й футболка друкуються з кавенятка гравця, і гравець сам обирає, з
-- якого (власник, 01.10.2026). Кущ після замовлення живе далі — росте,
-- переодягається, може піти на ринок, — тож друкуємо не «кавенятко», а
-- знімок того, яким воно було в момент замовлення: print_snapshot (стадія,
-- вигляд, вдягнене). print_r2_key — PNG для друку в бакеті uploads
-- (prints/<id>.png); його малює застосунок із тих самих спрайтів, що й
-- головний екран, а адмінка звідти завантажує файл у друкарню.
alter table redemptions
  add column print_plant_id uuid references plants(id) on delete set null,
  add column print_snapshot jsonb,
  add column print_r2_key text;

-- migrate:down

alter table redemptions
  drop column print_r2_key,
  drop column print_snapshot,
  drop column print_plant_id;
