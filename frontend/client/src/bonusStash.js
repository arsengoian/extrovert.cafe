// Бонуси, які гість отримав до входу (QR з кіоска), — на цьому пристрої.
// Раніше бонус жив лише в пам'яті стартового екрана: перезавантаження
// сторінки його губило (адресу з токеном ми одразу чистимо), а новий QR
// заміщав попередній. Тепер токени накопичуються тут, стартовий екран
// показує їх разом — усі монети однією сумою й кожен предмет плиткою, — а
// після входу всі зараховуються на акаунт (власник, 28.09.2026).
//
// Лише токени, без сум: суму й предмети щоразу питаємо в api, бо бонус
// могли вже забрати, а довіряти числам із localStorage немає причин.
const KEY = "extrovert.bonuses";

export function stashedBonuses() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => typeof t === "string" && t) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(list)])); } catch { /* приватний режим — тримаємо лише в пам'яті */ }
}

export const stashBonus = (token) => { if (token) save([...stashedBonuses(), token]); };
export const dropBonus = (token) => save(stashedBonuses().filter((t) => t !== token));
export const clearBonuses = () => save([]);
export const isStashed = (token) => stashedBonuses().includes(token);
