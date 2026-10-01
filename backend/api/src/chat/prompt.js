// Складання промпта для чату з кавенятком.
//
// Три шари контексту: хто воно таке (persona + rules із backend/api/data/prompts.json),
// що воно знає про гравця (facts — зібрані з бази прямо зараз) і що воно
// знає про гру (knowledge — знайдені документи бази знань).
//
// Живі числа (ціни, ліміти) підставляються з economy.json, а не з текстів
// бази знань: інакше після зміни ціни кавенятко ще місяць називало б стару.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { economy } from "../economy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const prompts = JSON.parse(readFileSync(path.join(HERE, "..", "..", "data", "prompts.json"), "utf8"));

// Службові ключі "$…" у economy.json — коментарі для людей, не дані.
const real = (obj) => Object.entries(obj).filter(([k]) => !k.startsWith("$"));

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);

const MOOD = { healthy: "здоровий", sad: "сумний, давно без поливу", withered: "зів'ялий, дуже давно без поливу" };
const POINT_STATUS = { live: "працює", paused: "тимчасово не працює", planned: "скоро відкриється" };
const CARE_NAME = { water: "вода", compost: "компост", fertilizer: "добриво", insecticide: "інсектицид" };

// Короткий зріз економіки: тільки те, про що реально питають.
function economyLines() {
  const c = economy.care;
  return [
    `вода: пачка ${c.water.batch_liters} л за ${c.water.price_coins} монет, 1 л = 1 полив`,
    `компост ${c.compost.unit_price_coins}, добриво ${c.fertilizer.unit_price_coins}, інсектицид ${c.insecticide.unit_price_coins} монет за одиницю`,
    `скринька: ${economy.crate.price_coins} монет або ${economy.crate.price_uah} грн`,
    `одяг напряму: ${real(economy.clothing_direct_price_coins).map(([t, p]) => `${t} ${p}`).join(", ")} монет`,
    `зерна за комплект: ${real(economy.set.beans_by_tier).map(([t, b]) => `${t} ${b}`).join(", ")}`,
    `повідомлення в чаті: перші ${economy.chat.free_messages} безкоштовні, далі ${economy.chat.price_coins} монета`,
    `пост у соцмережі: ${economy.repost.coins} срібних, раз на ${economy.repost.min_days_between} днів, максимум ${economy.repost.max_per_account} за акаунт`,
    `квіз: анкета ${economy.quiz.profile_coins} срібних, про напій ${economy.quiz.drink_coins}`,
  ];
}

const SLOT_NAME = { head: "голова", body: "тіло", pants: "штани", feet: "взуття", acc_1: "аксесуар" };
const itemList = (items) => items.map((i) => `${i.name} (${SLOT_NAME[i.slot] ?? i.slot}, ${i.tier})`).join(", ");

// Одяг кавенятка поіменно: подаровані комплекти, примірочна й що вдягнене.
// Зерна за комплект отримує гравець — кавенятку дарують лише одяг. Рядок
// «+N зерен уже нараховано» біля комплекту модель читала як зерна, подаровані
// їй самій (власник, 28.09.2026), тому одержувач названий прямо.
export function wardrobeLines(sets, wornSetId, nickname) {
  const lines = [];
  const gifted = sets.filter((s) => s.gifted);
  const fitting = sets.find((s) => !s.gifted && s.items.length);
  if (gifted.length) {
    lines.push(`подарований тобі одяг: ${gifted.map((s, n) => `комплект ${n + 1} (${s.tier}): ${itemList(s.items)}`).join("; ")}`);
    const beans = gifted.reduce((sum, s) => sum + (s.beans_awarded ?? 0), 0);
    lines.push(`за подаровані комплекти ${beans} зерен отримав ${nickname}, а не ти: тобі дарують лише одяг, зерна дістаються гравцеві`);
  } else {
    lines.push("подарованого одягу в тебе ще немає");
  }
  if (fitting) lines.push(`у примірочній, ще не подаровано: ${itemList(fitting.items)} (${fitting.items.length} з 5 слотів)`);

  const n = gifted.findIndex((s) => String(s.id) === String(wornSetId));
  if (n >= 0) lines.push(`зараз на тобі комплект ${n + 1}`);
  else if (fitting && String(fitting.id) === String(wornSetId)) lines.push("зараз на тобі речі з примірочної");
  else lines.push("зараз на тобі нічого не вдягнено");
  return lines;
}

// Факти про акаунт. Порядок навмисний: спершу те, про що питають найчастіше.
// Про саме кавенятко — у другій особі («ти»): рядок «кавенятко хоче води»
// модель повторювала як є й говорила про себе в третій особі (власник,
// 28.09.2026).
export function factLines({ user, plant, growth, care, counts, wardrobe, orders, lastDrinks }) {
  const lines = [
    `нікнейм гравця: ${user.nickname}`,
    `баланси гравця: ${user.coins_yellow} жовтих, ${user.coins_silver} срібних, ${user.beans} зерен`,
    `ти: «${plant.name ?? "без імені"}», стадія ${plant.growth_stage} з 10, ${MOOD[plant.mood] ?? plant.mood}`,
  ];

  if (growth?.done) lines.push("ти вже дорослий: далі врожай і новий цикл");
  else if (growth) {
    const need = CARE_NAME[growth.need] ?? growth.need;
    const progress = growth.applications > 1 ? ` (застосовано ${growth.progress} з ${growth.applications})` : "";
    lines.push(`ти хочеш зараз: ${need}${progress}`);
    if (growth.planting) lines.push(`наступний крок — посадка: ${growth.planting}`);
    if (growth.ready_at) lines.push(`наступна стадія відкриється ${new Date(growth.ready_at).toLocaleString("uk-UA")}`);
  }

  lines.push(`на поличці: ${care.water_liters} л води, ${care.compost_kg} компосту, ${care.fertilizer_kg} добрива, ${care.insecticide_bottles} інсектициду`);
  lines.push(`на складі: ${counts.items} предметів одягу${counts.listed ? `, ${counts.listed} на продажу` : ""}`);
  lines.push(`куплено напоїв за весь час: ${counts.drinks}${counts.unclaimed ? `, незабраних бонусів: ${counts.unclaimed}` : ""}`);

  lines.push(...wardrobeLines(wardrobe ?? [], plant.worn_set_id, user.nickname));
  if (orders?.length) {
    lines.push(`замовлення: ${orders.map((o) => `${o.title} — ${o.status}`).join("; ")}`);
  }
  if (lastDrinks?.length) {
    lines.push(`останні напої: ${lastDrinks.map((d) => `${d.name} (${new Date(d.fiscal_date).toLocaleDateString("uk-UA")})`).join(", ")}`);
  }
  return lines;
}

// Точки з бази, а не з бази знань: адреса й статус міняються без релізу,
// і кавенятко має знати їх усі, про що б не питали (власник, 28.09.2026).
export function pointLines(points) {
  return points.map((p) => `${p.name}: ${p.address ?? p.short_address ?? "адресу ще уточнюємо"} — ${POINT_STATUS[p.status] ?? p.status}`);
}

export function systemPrompt({ plant, user, facts, knowledge, points = [] }) {
  const vars = { plant_name: plant.name ?? "Кавенятко", nickname: user.nickname };
  const s = prompts.sections;
  const parts = [
    prompts.persona.map((p) => fill(p, vars)).join(" "),
    `Правила:\n${prompts.rules.map((r) => `- ${r}`).join("\n")}`,
    `${s.facts}:\n${facts.map((f) => `- ${f}`).join("\n")}`,
    `${s.economy}:\n${economyLines().map((l) => `- ${l}`).join("\n")}`,
  ];
  if (points.length) parts.push(`${s.points}:\n${pointLines(points).map((l) => `- ${l}`).join("\n")}`);
  if (knowledge.length) {
    parts.push(`${s.knowledge}:\n${knowledge.map(({ doc }) => `### ${doc.title}\n${doc.body}`).join("\n\n")}`);
  }
  return parts.join("\n\n");
}

// Сповіщення пишуть валюту токеном (:gold: — іконка в чаті, lib/notify.js),
// а моделі потрібні слова: інакше вона повторює двокрапки у відповідях.
const CURRENCY_WORDS = { ":gold:": "золотих монет", ":silver:": "срібних монет", ":bean:": "зерен" };
const words = (text) => String(text ?? "").replace(/:gold:|:silver:|:bean:/g, (t) => CURRENCY_WORDS[t]);

// Історія йде окремими репліками, а не злитим текстом: модель краще тримає
// чергу «гравець — кавенятко», коли ролі розділені.
export function buildMessages({ plant, user, facts, knowledge, points, history, message }) {
  return [
    { role: "system", content: systemPrompt({ plant, user, facts, knowledge, points }) },
    ...history.map((m) => ({ role: m.role === "plant" ? "assistant" : "user", content: words(m.body) })),
    { role: "user", content: message },
  ];
}
