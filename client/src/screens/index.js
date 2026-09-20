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
import { Profile } from "./Profile.jsx";
import { NicknameChange } from "./NicknameChange.jsx";
import { Problem } from "./Problem.jsx";
import { QuizProfile } from "./QuizProfile.jsx";
import { QuizDrink } from "./QuizDrink.jsx";
import { Repost } from "./Repost.jsx";
import { Planting } from "../plant/Planting.jsx";
import { Wardrobe } from "./Wardrobe.jsx";
import { Chat } from "./Chat.jsx";
import { ShopItem } from "./ShopItem.jsx";
import { SellItem } from "./SellItem.jsx";
import { WearItem } from "./WearItem.jsx";
import { Listings } from "./Listings.jsx";
import { SellPlant } from "./SellPlant.jsx";
import { PlantMarket } from "./PlantMarket.jsx";

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

  // Шторки: показуються поверх поточної вкладки, back-топбар їм не потрібен
  profile: { component: Profile, presentation: "sheet" },
  nicknameChange: { component: NicknameChange, presentation: "sheet" },

  problem: { component: Problem, title: "Що не працює?" },
  quizProfile: { component: QuizProfile, title: "Розкажи про себе" },
  quizDrink: { component: QuizDrink, title: "Опитування про напій" },
  repost: { component: Repost, title: "Репост у соцмережі" },
  planting: { component: Planting, title: (p) => p.title ?? "Посадка", hideNav: true },
  wardrobe: { component: Wardrobe, title: "Гардероб" },
  chat: { component: Chat, title: (p) => p.plant?.name ?? "Кавенятко", hideNav: true },
  shopProduct: { component: ShopItem, title: (p) => p.item?.title ?? "Товар" },
  sellItem: { component: SellItem, title: "Продати на P2P" },
  wearItem: { component: WearItem, title: "Кому вдягнути" },
  listings: { component: Listings, title: "На продажу" },
  sellPlant: { component: SellPlant, title: "Продати кавенятко" },
  plantMarket: { component: PlantMarket, title: "Нове кавенятко" },
};
