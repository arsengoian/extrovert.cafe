-- migrate:up

-- Кущ, який хоч раз продавали на ринку, не можна було скосити: delete з
-- plants каскадом видаляв його старі лоти, а на проданий лот посилається
-- угода (market_trades.listing_id без каскаду) — і весь запит падав 500-кою
-- (03.10.2026, ручне тестування). Те саме з одягом: скошування видаляє
-- подарований кущу комплект, і річ, колись куплена на ринку, тримала
-- видалення своїм лотом (market_listings.user_item_id без дії на delete).
--
-- Лот — це історія угоди (оборот ринку в адмінці рахується через нього),
-- тож він лишається, а посилання на зниклий кущ чи річ стає порожнім.
-- Порожнім воно може бути лише в неактивного лота: видалити кущ чи річ,
-- що зараз на продажу, як і раніше не вийде.
alter table market_listings drop constraint market_listings_check;
alter table market_listings add constraint market_listings_check check (
  (kind = 'item' and plant_id is null and (user_item_id is not null or status <> 'active'))
  or (kind = 'plant' and user_item_id is null and (plant_id is not null or status <> 'active'))
);

alter table market_listings drop constraint market_listings_plant_id_fkey;
alter table market_listings add constraint market_listings_plant_id_fkey
  foreign key (plant_id) references plants (id) on delete set null;

alter table market_listings drop constraint market_listings_user_item_id_fkey;
alter table market_listings add constraint market_listings_user_item_id_fkey
  foreign key (user_item_id) references user_items (id) on delete set null;

-- migrate:down

alter table market_listings drop constraint market_listings_user_item_id_fkey;
alter table market_listings add constraint market_listings_user_item_id_fkey
  foreign key (user_item_id) references user_items (id);

alter table market_listings drop constraint market_listings_plant_id_fkey;
alter table market_listings add constraint market_listings_plant_id_fkey
  foreign key (plant_id) references plants (id) on delete cascade;

-- Лоти з порожнім посиланням назад не повернути (на них тримаються угоди):
-- відкат упаде на check, якщо такі вже є, — і так має бути.
alter table market_listings drop constraint market_listings_check;
alter table market_listings add constraint market_listings_check check (
  (kind = 'item' and user_item_id is not null and plant_id is null)
  or (kind = 'plant' and plant_id is not null and user_item_id is null)
);
