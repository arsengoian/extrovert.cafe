// Автогенерація нікнейма: «прикметник_кавове_слово», число в хвості лише
// тоді, коли пара вже зайнята (рішення власника 20.09.2026).
//
// Словник живе в базі (nickname_words) і заливається сідами: додати слово —
// це рядок у db/seeds/nickname_words.json, а не реліз коду.
import { many, one } from "./db.js";

let cache = null;          // { adjectives, nouns } — словник змінюється рідко
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

async function words() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await many("select kind, word, forms, gender from nickname_words where active");
  cache = {
    adjectives: rows.filter((r) => r.kind === "adjective"),
    nouns: rows.filter((r) => r.kind === "noun"),
  };
  cachedAt = Date.now();
  return cache;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export async function generateNickname() {
  const { adjectives, nouns } = await words();
  if (!adjectives.length || !nouns.length) {
    // Словника ще немає — краще чесний випадковий хвіст, ніж падіння
    // реєстрації через порожню таблицю.
    return `гість-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const noun = pick(nouns);
    const adjective = pick(adjectives);
    // Рід має збігатись: «бадьора арабіка», а не «бадьорий арабіка».
    const form = adjective.forms?.[noun.gender] ?? adjective.word;
    const base = `${form}_${noun.word}`;
    // Хвіст додаємо лише з другої спроби — перші кілька пар пробуємо голими.
    const candidate = attempt < 6 ? base : `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await one("select 1 from users where nickname = $1", [candidate]);
    if (!taken) return candidate;
  }

  return `гість-${Date.now().toString().slice(-6)}`;
}
