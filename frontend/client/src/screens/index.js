// Реєстр екранів: один список, з якого оболонка бере компонент і заголовок
// back-топбара. Вкладки — TAB_SCREEN, решта відкривається через ctx.push().
import { Plant } from "./Plant.jsx";
import { Wallet } from "./Wallet.jsx";
import { Shop } from "./Shop.jsx";
import { Catalog } from "./Catalog.jsx";
import { Stock } from "./Stock.jsx";
import { History } from "./History.jsx";
import { ItemCard } from "./ItemCard.jsx";
import { CratePreview } from "./Crate.jsx";
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
import { Listings } from "./Listings.jsx";
import { SellPlant } from "./SellPlant.jsx";
import { PlantMarket } from "./PlantMarket.jsx";
import { Transfer } from "./Transfer.jsx";
import { CoinPacks } from "./CoinPacks.jsx";
import { PlantName } from "./PlantName.jsx";
import { Legal } from "./Legal.jsx";
import { Bonus } from "./Bonus.jsx";
import { DeleteAccount } from "./DeleteAccount.jsx";
import { PaymentResult } from "./PaymentResult.jsx";
import { Checkout } from "./Checkout.jsx";
import { SizeChart } from "./SizeChart.jsx";
import { Orders } from "./Orders.jsx";
import { Order } from "./Order.jsx";

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

  // Шторки: показуються поверх поточної вкладки, back-топбар їм не потрібен
  profile: { component: Profile, presentation: "sheet" },
  nicknameChange: { component: NicknameChange, presentation: "sheet" },

  problem: { component: Problem, title: "Що не працює?", hideNav: true },
  quizProfile: { component: QuizProfile, title: "Розкажи про себе", hideNav: true },
  // Заголовок — напій і дата покупки, як у кадрі: «Лате · 17.09».
  quizDrink: {
    component: QuizDrink,
    title: (p) => p.item
      ? `${p.item.name} · ${new Date(p.item.fiscal_date).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}`
      : "Опитування про напій",
    hideNav: true,
  },
  repost: { component: Repost, title: "Репост у соцмережі" },
  planting: { component: Planting, title: (p) => p.title ?? "Посадка", hideNav: true },
  wardrobe: { component: Wardrobe, title: "Гардероб" },
  chat: { component: Chat, title: (p) => p.plant?.name ?? "Кавенятко", hideNav: true },
  shopProduct: { component: ShopItem, title: (p) => p.item?.title ?? "Товар" },
  sellItem: { component: SellItem, title: "Продати одяг" },
  listings: { component: Listings, title: "На продаж" },
  sellPlant: { component: SellPlant, title: "Продати кавенятко" },
  plantMarket: { component: PlantMarket, title: "Нове кавенятко" },
  transfer: { component: Transfer, title: "Переказати монети" },
  coinPacks: { component: CoinPacks, title: "Купити монети" },
  paymentResult: { component: PaymentResult, title: "Оплата" },
  plantName: { component: PlantName, title: "Імʼя кавенятка" },
  bonus: { component: Bonus, title: "Бонус за покупку" },
  checkout: { component: Checkout, title: "Оформлення" },
  sizeChart: { component: SizeChart, title: "Таблиця розмірів" },
  orders: { component: Orders, title: "Мої замовлення" },
  order: { component: Order, title: (p) => `Замовлення №${p.id}` },
  deleteAccount: { component: DeleteAccount, title: "Видалити акаунт" },
  terms: { component: Legal, title: "Умови користування", hideNav: true },
  privacy: { component: Legal, title: "Приватність", props: { doc: "privacy" }, hideNav: true },
  support: { component: Legal, title: "Підтримка", props: { doc: "support" }, hideNav: true },
};
