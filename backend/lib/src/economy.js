// Числа економіки й кидки, що з них випливають (docs/gamification_economy.md).
//
// Живе в спільній бібліотеці, а не в api, бо однакові правила потрібні двом
// сервісам: api відкриває крейти, а checkbox кидає лутдроп при чеку (§4.1).
// Другий набір тих самих чисел розійшовся б із першим на першій же правці
// балансу — а розходження в балансі помітно не одразу й дорого.
//
// Читається один раз на старті: параметри міняє реліз, а не адмінка
// (docs/db-schema.md §7).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const economy = JSON.parse(readFileSync(path.join(HERE, "..", "data", "economy.json"), "utf8"));

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

// Лутдроп за куплений напій (§4, §4.1): бонус-напій несе предмет завжди й
// за спільною таблицею тірів, звичайний — лише Common і лише інколи.
// Повертає тір або null, якщо не випало.
export function rollDrinkDrop(isBonus, rand = Math.random) {
  if (isBonus) return rollTier(rand);
  return rand() < economy.shadow_drop.chance ? economy.shadow_drop.tier : null;
}
