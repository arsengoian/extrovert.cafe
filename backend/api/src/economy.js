// Економіка для api. Числа й кидки, спільні з іншими сервісами, живуть у
// @extrovert/lib/economy.js — тут лише те, що потрібно самому api, плюс
// реекспорт, щоб чотирнадцять наявних імпортів лишились як були.
//
// Чому числа переїхали: той самий баланс потрібен checkbox — він кидає
// лутдроп при чеку (economy §4.1). Один набір на двох.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { economy, rollCrateCoins, rollTier, rollDrinkDrop } from "@extrovert/lib/economy.js";
import { economy } from "@extrovert/lib/economy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const shopProducts = JSON.parse(readFileSync(path.join(HERE, "..", "data", "shop-products.json"), "utf8"));

// Ціна прямої покупки одягу залежить лише від тіру (§5.1).
export const priceForTier = (tier) => economy.clothing_direct_price_coins[tier] ?? null;
