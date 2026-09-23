// Довідники, однакові для всіх: напої та каталог одягу. Обидва - контентні
// таблиці, заливаються сідами (docs/db-schema.md §7).
import { many } from "../db.js";
import { economy, priceForTier } from "../economy.js";

// Порядок, у якому набори показує «Весь одяг» (і Склад): тір від
// звичайного до епічного, усередині — як у таблиці концептів
// bush_graphics_customization.md §7.1, а не за абеткою. Набір, якого тут ще
// немає, стає в кінець свого тіру. Слоти — в порядку примірочної.
const TIER_ORDER = ["common", "uncommon", "rare", "epic"];
const SET_ORDER = [
  "Ковбой", "Тропічний серфер", "Кав'ярний хіпстер", "Строгий бариста", "Спортивний", "Студент",
  "Дощовий Київ", "Скейтер", "Кавовий ковбой Deluxe", "DJ/Клубер", "Ретро-геймер", "Мандрівник",
  "Пірат Кавових морів", "Космічний бариста", "Кавовий магнат",
];
const SLOT_ORDER = ["head", "body", "pants", "feet", "acc_1"];
const ORDER_BY = `array_position($3::text[], tier),
               coalesce(array_position($4::text[], collection), 1000), collection,
               array_position($5::text[], slot)`;

export default async function routes(app) {
  app.get("/catalog/drinks", async () => {
    const rows = await many(
      `select slot, name, vol, price_uah, coins, is_bonus, sprite, cup
         from drinks where active order by sort_order`
    );
    return { drinks: rows };
  });

  // Увесь одяг: екран «Весь одяг» у Магазині показує всі тіри, ціна
  // рахується з тіру, а не зберігається в рядку (§5.1).
  app.get("/catalog/items", async (req) => {
    const { tier, collection } = req.query ?? {};
    const rows = await many(
      `select code, name, collection, description_md, slot, tier, sprite_id
         from item_defs
        where active
          and ($1::text is null or tier = $1)
          and ($2::text is null or collection = $2)
        order by ${ORDER_BY}`,
      [tier ?? null, collection ?? null, TIER_ORDER, SET_ORDER, SLOT_ORDER]
    );
    return {
      items: rows.map((r) => ({ ...r, price_coins: priceForTier(r.tier) })),
      tiers: economy.clothing_direct_price_coins,
    };
  });

  // Набори одягу: Склад групує предмети саме за ними.
  app.get("/catalog/collections", async () => {
    const rows = await many(
      `select collection, tier, count(*)::int as items
         from item_defs where active and collection is not null
        group by collection, tier
        order by array_position($1::text[], tier), coalesce(array_position($2::text[], collection), 1000), collection`,
      [TIER_ORDER, SET_ORDER]
    );
    return { collections: rows };
  });
}
