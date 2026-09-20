// Довідники, однакові для всіх: напої та каталог одягу. Обидва - контентні
// таблиці, заливаються сідами (docs/db-schema.md §7).
import { many } from "../db.js";
import { economy, priceForTier } from "../economy.js";

export default async function routes(app) {
  app.get("/catalog/drinks", async () => {
    const rows = await many(
      `select system_code, name, vol, price_uah, coins, bonus_coins, sprite, cup
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
        order by tier, collection, slot`,
      [tier ?? null, collection ?? null]
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
        group by collection, tier order by tier, collection`
    );
    return { collections: rows };
  });
}
