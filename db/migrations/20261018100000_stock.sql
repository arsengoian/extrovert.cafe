-- migrate:up

-- Облік залишків (власник, 18.10.2026; docs/stock.md). Матеріали, закупки,
-- інвентаризації й рецепти; витрата рахується за кожним замовленням машини
-- за рецептом, чинним на мить покупки, а щоденний журнал зберігає, що ми
-- думали про залишок і прогноз того дня — щоб на інвентаризації порівняти
-- прогноз «за X днів до» з фактом.

-- Матеріали: що лежить на складі й витрачається. Кількість — у базових
-- одиницях (г, мл, шт); пачка — як купуємо, для підказок при підрахунку.
create table stock_items (
    id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
    name text not null,
    unit text not null check (unit in ('g', 'ml', 'pcs')),
    pack_size numeric(12, 3) check (pack_size > 0),
    pack_name text,
    kind text not null check (kind in ('ingredient', 'packaging', 'consumable')),
    -- Витрата за добу незалежно від продажів (пакети для сміття, вологі
    -- серветки на прибирання); 0 — лише за рецептами.
    per_day numeric(12, 3) not null default 0 check (per_day >= 0),
    -- Бункер Jetinno, з якого машина бере цей матеріал: імпорт рецептів із
    -- машини пише кроки рецепта в матеріал за цим номером (0 — вода).
    canister int unique,
    sort_order int not null default 0,
    active boolean not null default true,
    note text,
    created_at timestamptz not null default now()
);

-- Де рахуємо на інвентаризації. Залишок облікуємо загальний: переноси зі
-- складу на полицю його не змінюють, а місця — лише щоб нічого не забути.
create table stock_locations (
    id text primary key,
    name text not null,
    point_id text references points (id),
    kind text not null check (kind in ('warehouse', 'shelf', 'machine')),
    sort_order int not null default 0
);

-- Закупки: документ і його рядки. Рядок — або матеріал (кількість у
-- базових одиницях і вартість), або інша витрата з категорією: обладнання,
-- фіскалізація, послуги (CAPEX чи OPEX) — для «Фінансів».
create table stock_purchases (
    id bigserial primary key,
    received_at timestamptz not null,
    supplier text,
    doc text,
    note text,
    created_by text,
    created_at timestamptz not null default now()
);
create table stock_purchase_lines (
    id bigserial primary key,
    purchase_id bigint not null references stock_purchases (id) on delete cascade,
    kind text not null check (kind in ('material', 'capex', 'opex')),
    item_id text references stock_items (id),
    category text,
    description text not null,
    qty numeric(14, 3) check (qty > 0),
    cost_uah numeric(12, 2) not null check (cost_uah >= 0),
    check ((kind = 'material') = (item_id is not null)),
    check (kind <> 'material' or qty is not null)
);
create index stock_purchase_lines_purchase_idx on stock_purchase_lines (purchase_id);
create index stock_purchase_lines_item_idx on stock_purchase_lines (item_id);

-- Інвентаризації — джерело правди про кількість на мить підрахунку.
-- Матеріал, якого в інвентаризації немає, у ній не рахували (часткова);
-- редагувати можна лише останню (admin-stock.js).
create table stock_counts (
    id bigserial primary key,
    counted_at timestamptz not null,
    note text,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);
create table stock_count_lines (
    count_id bigint not null references stock_counts (id) on delete cascade,
    item_id text not null references stock_items (id),
    location_id text not null references stock_locations (id),
    qty numeric(14, 3) not null check (qty >= 0),
    primary key (count_id, item_id, location_id)
);
create index stock_count_lines_item_idx on stock_count_lines (item_id);

-- Рецепти версіями: версія — повний набір, чинний від valid_from до
-- наступної. Рядок — скільки матеріалу йде на напій (product_id — номер
-- продукту машини; 0 — на кожен напій, що його купили: мішалка, цукор) і
-- яка частка покупців його бере (кришку, цукор беруть не всі).
create table recipe_versions (
    id bigserial primary key,
    valid_from timestamptz not null unique,
    source text not null check (source in ('machine', 'admin')),
    note text,
    -- Назви продуктів машини на момент версії: {"33": "Еспресо", ...}.
    products jsonb not null default '{}',
    created_by text,
    created_at timestamptz not null default now()
);
create table recipe_lines (
    version_id bigint not null references recipe_versions (id) on delete cascade,
    product_id int not null check (product_id >= 0),
    item_id text not null references stock_items (id),
    qty numeric(12, 3) not null check (qty > 0),
    take_rate numeric(5, 4) not null default 1 check (take_rate > 0 and take_rate <= 1),
    primary key (version_id, product_id, item_id)
);

-- Витрата за кожним замовленням машини — за рецептом, чинним на мить
-- покупки. qty — очікувана (кількість × частка тих, хто бере), var — її
-- дисперсія (кількість² × p(1−p)): з неї похибка розрахунку на інвентаризації.
-- Рахує scheduler (jobs/stock.js) і перераховує, коли змінилась версія.
create table stock_usage (
    machine_order_id bigint not null references machine_orders (id) on delete cascade,
    item_id text not null references stock_items (id),
    recipe_version_id bigint not null references recipe_versions (id) on delete cascade,
    used_at timestamptz not null,
    qty numeric(14, 4) not null,
    var numeric(16, 6) not null default 0,
    primary key (machine_order_id, item_id)
);
create index stock_usage_item_used_idx on stock_usage (item_id, used_at);

-- Щоденний журнал по кожному матеріалу: розрахунковий залишок на кінець
-- київської доби, розрахункова витрата за неї й прогноз витрати вперед
-- ({"7": [середнє, σ], "14": …, "30": …}), «на скільки вистачить» за
-- середнім і з імовірністю 90 %. Минулі доби не переписуються: це те, що
-- ми знали того дня (власник: «проекції станом на X днів до того
-- логуємо»). Доби до появи журналу дораховані тим самим кодом лише з
-- даних, що були на той день.
create table stock_daily (
    day date not null,
    item_id text not null references stock_items (id) on delete cascade,
    -- Мить, яку описує рядок: кінець доби для минулих, мить останнього
    -- перерахунку для сьогоднішньої. Прогноз іде вперед саме від неї.
    as_of timestamptz not null,
    book_qty numeric(14, 3),
    used_qty numeric(14, 3) not null default 0,
    used_var numeric(16, 6) not null default 0,
    forecast jsonb,
    cover_days numeric(8, 1),
    cover_days_p90 numeric(8, 1),
    computed_at timestamptz not null default now(),
    primary key (day, item_id)
);

-- ── Стартові дані ───────────────────────────────────────────────────────
-- Матеріали — з таблиці фактичних витрат (Zernova_accounting.xlsx, «Витрати
-- — ФАКТ») і прайсів: кава й шоколад — пачки по 1 кг, молоко BREWMIST Milk
-- 100% — по 900 г, цукор — 200 стіків по 5 г, матча — 1 кг (власник,
-- 18.10.2026). Бункери — canister_config.json машини.
insert into stock_items (id, name, unit, pack_size, pack_name, kind, canister, sort_order) values
    ('coffee',      'Кава BREWMIST Blend №1',             'g',   1000,  'пачка 1 кг',      'ingredient', 170, 10),
    ('milk',        'Сухе молоко BREWMIST Milk 100%',      'g',   900,   'пачка 900 г',     'ingredient', 2,   20),
    ('chocolate',   'Шоколад BREWMIST',                    'g',   1000,  'пачка 1 кг',      'ingredient', 3,   30),
    ('matcha',      'Матча MATCHA PULVER (бункер 1)',      'g',   1000,  'пачка 1 кг',      'ingredient', 1,   40),
    ('water',       'Вода',                                'ml',  20000, 'бутель 20 л',     'ingredient', 0,   50),
    ('syrup_irish', 'Сироп Maribell «Ірландський віскі»',  'ml',  1000,  'пляшка 1 л',      'ingredient', null, 60),
    ('cup_s',       'Стакан S 110 мл з друком',            'pcs', null,  null,              'packaging',  null, 110),
    ('cup_m',       'Стакан M 175 мл з друком',            'pcs', null,  null,              'packaging',  null, 120),
    ('cup_l',       'Стакан L 340 мл з друком',            'pcs', null,  null,              'packaging',  null, 130),
    ('lid_m',       'Кришка під стакан M',                 'pcs', 200,   'уп. 200 шт',      'packaging',  null, 140),
    ('lid_l',       'Кришка T-79 чорна (стакан L)',        'pcs', 100,   'уп. 100 шт',      'packaging',  null, 150),
    ('stirrer',     'Мішалка деревʼяна',                   'pcs', 500,   'уп. 500 шт',      'consumable', null, 210),
    ('sugar',       'Цукор у стіках 5 г',                  'pcs', 200,   'уп. 200 шт, 1 кг', 'consumable', null, 220),
    ('straw',       'Трубочка з гофрою',                   'pcs', 200,   'уп. 200 шт',      'consumable', null, 230),
    ('napkin',      'Серветки паперові',                   'pcs', 500,   'уп. 500 шт',      'consumable', null, 240),
    ('wet_wipes',   'Серветки вологі',                     'pcs', 120,   'уп. 120 шт',      'consumable', null, 250),
    ('trash_bag',   'Пакет для сміття 60 л',               'pcs', 10,    'уп. 10 шт',       'consumable', null, 260);

insert into stock_locations (id, name, point_id, kind, sort_order) values
    ('warehouse', 'Склад', null, 'warehouse', 10);
insert into stock_locations (id, name, point_id, kind, sort_order)
select v.id, v.name, 'kyiv-01', v.kind, v.sort_order
  from (values ('kyiv-01:shelf', 'Кавʼярня — полиці', 'shelf', 20),
               ('kyiv-01:machine', 'Кавʼярня — бункери машини', 'machine', 30)) v (id, name, kind, sort_order)
 where exists (select 1 from points where id = 'kyiv-01');

-- Закупки — усі рядки таблиці фактичних витрат (власник: «заносити все»):
-- матеріали — на склад, обладнання, фіскалізація, брендинг, пошук локації —
-- як CAPEX. Час отримання — полудень дати з таблиці (точніше в ній немає).
-- Подарунковий набір Zernova (3 пачки кави, 2 молока, 1 шоколаду —
-- «CAPEX план-факт», ІНВЕНТАРИЗАЦІЯ.md) — окремою закупкою з нульовою ціною.
with p as (
    insert into stock_purchases (received_at, supplier, doc, note, created_by) values
        ('2026-07-31 12:00+03', 'Zernova', 'КП26073001', 'передоплата за машину, 1140 EUR', 'import'),
        ('2026-07-31 12:00+03', null, 'НП26073001', 'послуги пошуку локації, 380 EUR', 'import'),
        ('2026-09-07 12:00+03', null, null, 'кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'import'),
        ('2026-09-11 12:00+03', 'друк-шоп', '#67961, #68087, #68115, #68372, #68384, #68385', 'стакани з друком, кришки M, лого', 'import'),
        ('2026-09-25 12:00+03', null, 'рахунок №2022 від 25.09.2026', 'фіскалізація', 'import'),
        ('2026-09-29 12:00+03', 'Zernova', 'Рахунок №2803', 'стартові інгредієнти й витратні', 'import'),
        ('2026-09-29 12:00+03', 'Zernova', null, 'подарунковий набір до стартової закупки', 'import')
    returning id, doc, note
)
insert into stock_purchase_lines (purchase_id, kind, item_id, category, description, qty, cost_uah)
select p.id, l.kind, l.item_id, l.category, l.description, l.qty, l.cost
  from p join (values
    ('передоплата за машину, 1140 EUR', 'capex', null, 'обладнання (машина)', 'Передоплата (завдаток) за КП26073001, 1140 EUR', null::numeric, 58140::numeric),
    ('послуги пошуку локації, 380 EUR', 'capex', null, 'пошук локації', 'Послуги пошуку локації НП26073001, 380 EUR', null, 19380),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (кабелі)', 'Мережевий кабель', null, 49),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (кабелі)', 'Органайзер для кабелів RZTK Stick Pack', null, 129),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (кабелі)', 'Кабель RZTK HDMI-HDMI 4K v.2.0, 1.8 м', null, 109),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (флешка/SD)', 'USB Flash Wibrand USB 2.0 Chameleon 32Gb', null, 279),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (флешка/SD)', 'Карта памʼяті microSDHC 16Gb class 10 Wibrand', null, 310),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (переноска)', 'Подовжувач UA Power F17, 2 м, 7 розеток', null, 360),
    ('кабелі, флешка, картка памʼяті, подовжувач, кронштейн', 'capex', null, 'обладнання (кронштейн)', 'Кронштейн для телевізора MounTech TWBR-211', null, 870),
    ('стакани з друком, кришки M, лого', 'material', 'lid_m', null, 'Кришки для паперових стаканчиків, 200 шт — під стакан M (#68385)', 200, 160),
    ('стакани з друком, кришки M, лого', 'material', 'lid_m', null, 'Кришки для паперових стаканчиків, 200 шт (другий розмір) — під стакан M (#68384)', 200, 160),
    ('стакани з друком, кришки M, лого', 'material', 'cup_l', null, 'Друк на паперових стаканчиках 340 мл, тираж 500 (#68372)', 500, 2222),
    ('стакани з друком, кришки M, лого', 'material', 'cup_m', null, 'Друк на паперових стаканчиках 175 мл, тираж 500 (#68115)', 500, 1587),
    ('стакани з друком, кришки M, лого', 'capex', null, 'брендинг / дизайн', 'Лого кавʼярні, самоклеюча плівка Black Out (#68087)', null, 280),
    ('стакани з друком, кришки M, лого', 'material', 'cup_s', null, 'Друк на паперових стаканчиках 110 мл, тираж 500 (#67961)', 500, 1428),
    ('фіскалізація', 'capex', null, 'фіскалізація', 'Оплата послуг фіскалізації', null, 4974),
    ('стартові інгредієнти й витратні', 'material', 'stirrer', null, 'Мішалка деревʼяна 500 шт/уп × 2', 1000, 350),
    ('стартові інгредієнти й витратні', 'material', 'straw', null, 'Трубочки з гофрою 200 шт/уп × 2', 400, 200),
    ('стартові інгредієнти й витратні', 'material', 'sugar', null, 'Цукор у стіках 200 шт/уп 1 кг × 5', 1000, 400),
    ('стартові інгредієнти й витратні', 'material', 'napkin', null, 'Серветки паперові 500 шт/уп × 2', 1000, 150),
    ('стартові інгредієнти й витратні', 'material', 'wet_wipes', null, 'Серветки вологі 120 шт/уп × 2', 240, 120),
    ('стартові інгредієнти й витратні', 'material', 'trash_bag', null, 'Пакети для сміття 60 л 10 шт/уп × 2', 20, 160),
    ('стартові інгредієнти й витратні', 'material', 'lid_l', null, 'Кришка для стаканів T-79 чорна (100 шт) × 3', 300, 510),
    ('стартові інгредієнти й витратні', 'material', 'syrup_irish', null, 'Сироп Maribell Ірландський віскі 1 л × 1', 1000, 130),
    ('стартові інгредієнти й витратні', 'capex', null, 'обладнання', 'Дозатор для сиропу × 1', null, 125),
    ('стартові інгредієнти й витратні', 'material', 'matcha', null, 'MATCHA PULVER × 1', 1000, 960),
    ('стартові інгредієнти й витратні', 'material', 'coffee', null, 'Кава BREWMIST Blend №1 × 9 (680 ₴)', 9000, 6120),
    ('стартові інгредієнти й витратні', 'material', 'milk', null, 'Сухе молоко BREWMIST Milk 100% × 15 (500 ₴)', 13500, 7500),
    ('стартові інгредієнти й витратні', 'material', 'chocolate', null, 'Шоколад BREWMIST × 4 (330 ₴)', 4000, 1320),
    ('подарунковий набір до стартової закупки', 'material', 'coffee', null, 'Кава BREWMIST Blend №1 × 3, подарунок', 3000, 0),
    ('подарунковий набір до стартової закупки', 'material', 'milk', null, 'Сухе молоко BREWMIST Milk 100% × 2, подарунок', 1800, 0),
    ('подарунковий набір до стартової закупки', 'material', 'chocolate', null, 'Шоколад BREWMIST × 1, подарунок', 1000, 0)
  ) l (note, kind, item_id, category, description, qty, cost) on l.note = p.note;

-- Перша версія рецептів — з резервної копії машини (Recipe_Product_Zip
-- 11.10.2026; копія 08.10 така сама, раніших не робили, тож чинна від
-- запуску). Грами — gradientWeight кроків, вода — сума waterVolume. Стакан
-- і кришка — за розміром стакана напою в меню (drinks.cup); кришку й
-- мішалку фінмодель кладе на кожну чашку (частка 1) — до першої
-- інвентаризації, яка покаже справжню частку. Цукор, серветки й трубочки
-- без норми: моделі для них немає, прогнозу теж не буде, доки норму не
-- задати.
with v as (
    insert into recipe_versions (valid_from, source, note, products, created_by) values
        ('2026-10-01 00:00+03', 'machine', 'резервна копія машини 11.10.2026 (Recipe_Product_Zip_2026_10_11_15_52_43); стакан і кришка — за меню, кришка й мішалка — з фінмоделі',
         '{"33": "Еспресо", "27": "Кава лунго", "26": "Подвійне еспресо", "102": "Кортадо (еспресо з молоком)", "34": "Американо", "36": "Американо з молоком", "38": "Капучино", "15": "Мокачіно", "39": "Лате", "17": "Флет вайт", "24": "Какао", "22": "Гарячий шоколад", "18": "Ірландський віскі", "107": "Окріп"}',
         'import')
    returning id
)
insert into recipe_lines (version_id, product_id, item_id, qty, take_rate)
select v.id, l.product_id, l.item_id, l.qty, l.take_rate
  from v, (values
    (33, 'coffee', 14, 1.0), (33, 'water', 40, 1.0), (33, 'cup_s', 1, 1.0),
    (27, 'coffee', 14, 1.0), (27, 'water', 70, 1.0), (27, 'cup_s', 1, 1.0),
    (26, 'coffee', 14, 1.0), (26, 'water', 80, 1.0), (26, 'cup_s', 1, 1.0),
    (102, 'coffee', 14, 1.0), (102, 'milk', 11, 1.0), (102, 'water', 65, 1.0), (102, 'cup_m', 1, 1.0), (102, 'lid_m', 1, 1.0),
    (34, 'coffee', 14, 1.0), (34, 'water', 110, 1.0), (34, 'cup_m', 1, 1.0), (34, 'lid_m', 1, 1.0),
    (36, 'coffee', 13, 1.0), (36, 'milk', 25, 1.0), (36, 'water', 150, 1.0), (36, 'cup_l', 1, 1.0), (36, 'lid_l', 1, 1.0),
    (38, 'coffee', 12, 1.0), (38, 'milk', 33, 1.0), (38, 'water', 185, 1.0), (38, 'cup_l', 1, 1.0), (38, 'lid_l', 1, 1.0),
    (15, 'coffee', 10, 1.0), (15, 'milk', 33, 1.0), (15, 'chocolate', 10, 1.0), (15, 'water', 230, 1.0), (15, 'cup_l', 1, 1.0), (15, 'lid_l', 1, 1.0),
    (39, 'coffee', 13, 1.0), (39, 'milk', 33, 1.0), (39, 'water', 210, 1.0), (39, 'cup_l', 1, 1.0), (39, 'lid_l', 1, 1.0),
    (17, 'coffee', 14, 1.0), (17, 'milk', 33, 1.0), (17, 'water', 210, 1.0), (17, 'cup_l', 1, 1.0), (17, 'lid_l', 1, 1.0),
    (24, 'milk', 22, 1.0), (24, 'chocolate', 27, 1.0), (24, 'water', 150, 1.0), (24, 'cup_l', 1, 1.0), (24, 'lid_l', 1, 1.0),
    (22, 'chocolate', 50, 1.0), (22, 'water', 190, 1.0), (22, 'cup_l', 1, 1.0), (22, 'lid_l', 1, 1.0),
    (18, 'matcha', 25, 1.0), (18, 'milk', 15, 1.0), (18, 'water', 140, 1.0), (18, 'cup_l', 1, 1.0), (18, 'lid_l', 1, 1.0),
    (107, 'water', 10, 1.0),
    (0, 'stirrer', 1, 1.0)
  ) l (product_id, item_id, qty, take_rate);

-- migrate:down

drop table stock_daily;
drop table stock_usage;
drop table recipe_lines;
drop table recipe_versions;
drop table stock_count_lines;
drop table stock_counts;
drop table stock_purchase_lines;
drop table stock_purchases;
drop table stock_locations;
drop table stock_items;
