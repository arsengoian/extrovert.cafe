// Магазин: два розділи, як в UI — за монети й за кавові боби
// (gamification_ui.md, Магазин). Ціни беремо з backend/api/data/economy.json, а
// габарити товарів — із shop-products.json (вони потрібні для НП).
import { economy, shopProducts } from "../economy.js";

const product = (id) => shopProducts.products.find((p) => p.id === id) ?? null;

export default async function routes(app) {
  app.get("/shop", async () => {
    const e = economy;
    const beans = e.shop_beans;

    const coins = [
      {
        code: "clothing",
        kind: "link",
        title: "Одяг",
        subtitle: "усі тіри, ціна росте з рідкістю",
        icon: "assets/ui/hat.png",
        price_from: e.clothing_direct_price_coins.common,
        currency: "yellow",
        target: "catalog",
      },
      {
        code: "crate",
        kind: "crate",
        title: "Щаслива скринька",
        subtitle: "предмет і монети — завжди обидва",
        icon: "assets/ui/crate.png",
        price: e.crate.price_coins,
        price_uah: e.crate.price_uah,
        currency: "yellow",
        odds: e.crate.odds,
        coins_range: [e.crate.coins.min, e.crate.coins.max],
      },
      {
        code: "sapling",
        kind: "sapling",
        title: "Новий саджанець",
        subtitle: "ще одне кавенятко",
        icon: "assets/ui/sprout.png",
        price: e.sapling.price_coins,
        currency: "yellow",
      },
      {
        code: "water",
        kind: "care",
        title: "Вода",
        subtitle: `${e.care.water.batch_liters} л у відро`,
        icon: "assets/ui/bucket.png",
        price: e.care.water.price_coins,
        currency: "yellow",
      },
      ...["compost", "fertilizer", "insecticide"].map((code) => ({
        code,
        kind: "care",
        title: { compost: "Компост", fertilizer: "Добриво", insecticide: "Інсектицид" }[code],
        subtitle: `пачка ${e.care[code].batch_units} од.`,
        // Добриво намальоване як мінеральне (assets/ui/mineral.png) — ім'я
        // файла з дизайну не збігається з кодом товару, і «assets/ui/
        // fertilizer.png» давало биту картинку в магазині.
        icon: `assets/ui/${code === "fertilizer" ? "mineral" : code}.png`,
        price: e.care[code].price_coins,
        currency: "yellow",
      })),
    ];

    const beansItems = [
      {
        code: "pos_discount",
        kind: "discount",
        title: beans.pos_discount.label,
        subtitle: `≈ ${beans.pos_discount.uah} грн знижки на наступну каву`,
        icon: "assets/ui/coin_gold.png",
        price: beans.pos_discount.beans,
        currency: "beans",
      },
      {
        code: "coffee_250g",
        kind: "delivery",
        title: product("coffee_250g")?.name ?? "Кава 250 г",
        subtitle: "доставка Новою Поштою",
        icon: "assets/ui/coffee250.png",
        price: beans.coffee_250g.beans,
        currency: "beans",
        packed: product("coffee_250g")?.packed ?? null,
      },
      {
        code: "merch_cup",
        kind: "delivery",
        title: product("merch_cup")?.name ?? "Чашка",
        subtitle: "з принтом extrovert.cafe",
        icon: "assets/ui/merch_cup.png",
        price: beans.merch_cup.beans,
        currency: "beans",
        packed: product("merch_cup")?.packed ?? null,
      },
      {
        code: "custom_print",
        kind: "delivery",
        title: product("custom_print")?.name ?? "Футболка з твоїм кавенятком",
        subtitle: "тільки твій — унікальний вигляд саме твого кавенятка",
        icon: "assets/ui/custom_print.png",
        price: beans.custom_print.beans,
        currency: "beans",
        packed: product("custom_print")?.packed ?? null,
        options: { size: ["XS", "S", "M", "L", "XL", "XXL"] },
      },
      {
        code: "sapling_beans",
        kind: "sapling",
        title: "Новий саджанець",
        subtitle: "ще одне кавенятко",
        icon: "assets/ui/sprout.png",
        price: beans.sapling.beans,
        currency: "beans",
      },
      {
        code: "beans_to_coins",
        kind: "exchange",
        title: "Обміняти зерна на монети",
        subtitle: `1 зерно → ${e.beans.rate_coins} монет`,
        icon: "assets/ui/beans_to_coins.png",
        price: 1,
        currency: "beans",
        gives_coins: e.beans.rate_coins,
      },
    ];

    return { coins, beans: beansItems };
  });

  // Набори монет за гривню (§9.1). Ціни ще не затверджені — віддаємо як є,
  // клієнт покаже «—» замість вигаданого числа.
  app.get("/shop/coin-packs", async () => ({ packs: economy.coin_packs }));
}
