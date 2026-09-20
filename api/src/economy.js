// Параметри економіки читаються один раз на старті: їх міняє реліз, а не
// адмінка (docs/db-schema.md §7).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(HERE, "..", "data", name), "utf8"));

export const economy = read("economy.json");
export const shopProducts = read("shop-products.json");

// Ціна прямої покупки одягу залежить лише від тіру (§5.1).
export const priceForTier = (tier) => economy.clothing_direct_price_coins[tier] ?? null;

// Монети з крейта: зрізаний нормальний розподіл у діапазоні (§4.2).
// Виходить за межі — перекидаємо, і лише після пʼяти спроб затискаємо,
// щоб цикл не став нескінченним на дивних параметрах.
export function rollCrateCoins(rand = Math.random) {
  const { min, max, mu, sigma } = economy.crate.coins;
  for (let i = 0; i < 5; i++) {
    const u = 1 - rand();
    const v = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const x = Math.round(mu + z * sigma);
    if (x >= min && x <= max) return x;
  }
  return Math.min(max, Math.max(min, Math.round(mu)));
}

// Тір предмета з крейта: спільна таблиця шансів для всіх тірів (§4).
export function rollTier(rand = Math.random) {
  const odds = economy.crate.odds;
  let r = rand();
  for (const [tier, p] of Object.entries(odds)) {
    if (r < p) return tier;
    r -= p;
  }
  return "common";
}
