// Реєстр екранів: один список, з якого оболонка бере компонент і заголовок
// back-топбара. Вкладки — TAB_SCREEN, решта відкривається через ctx.push().
import { Plant } from "./Plant.jsx";
import { Wallet } from "./Wallet.jsx";
import { Shop } from "./Shop.jsx";
import { Catalog } from "./Catalog.jsx";
import { Stock } from "./Stock.jsx";
import { History } from "./History.jsx";
import { ItemCard } from "./ItemCard.jsx";
import { CratePreview, CrateResult } from "./Crate.jsx";

export const TAB_SCREEN = {
  wallet: "wallet",
  shop: "shop",
  plant: "plant",
  stock: "stock",
  history: "history",
};

export const SCREENS = {
  plant: { component: Plant },
  wallet: { component: Wallet },
  shop: { component: Shop },
  stock: { component: Stock },
  history: { component: History },

  catalog: { component: Catalog, title: "Одяг" },
  itemCard: { component: ItemCard, title: (p) => p.item?.name ?? "Предмет" },
  shopItem: { component: CratePreview, title: (p) => p.item?.title ?? "Товар" },
  crateResult: { component: CrateResult, title: "Скриньку відкрито" },
};
