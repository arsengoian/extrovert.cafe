// Складання промпта для чату з кавенятком.
//
// Три шари контексту: хто воно таке (persona + rules із api/data/prompts.json),
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

const MOOD = { healthy: "здорове", sad: "сумне, давно без поливу", withered: "зів'яле, дуже давно без поливу" };
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
    `репост: ${economy.repost.coins} срібних, раз на ${economy.repost.min_days_between} днів, максимум ${economy.repost.max_per_account} за акаунт`,
    `квіз: анкета ${economy.quiz.profile_coins} срібних, про напій ${economy.quiz.drink_coins}`,
  ];
}

// Факти про акаунт. Порядок навмисний: спершу те, про що питають найчастіше.
export function factLines({ user, plant, growth, care, counts, wardrobe, orders, lastDrinks }) {
  const lines = [
    `нікнейм: ${user.nickname}`,
    `баланси: ${user.coins_yellow} жовтих, ${user.coins_silver} срібних, ${user.beans} зерен`,
    `кавенятко: «${plant.name ?? "без імені"}», стадія ${plant.growth_stage} з 10, ${MOOD[plant.mood] ?? plant.mood}`,
  ];

  if (growth?.done) lines.push("кавенятко доросле: далі врожай і новий цикл");
  else if (growth) {
    const need = CARE_NAME[growth.need] ?? growth.need;
    const progress = growth.applications > 1 ? ` (застосовано ${growth.progress} з ${growth.applications})` : "";
    lines.push(`хоче зараз: ${need}${progress}`);
    if (growth.planting) lines.push(`наступний крок — посадка: ${growth.planting}`);
    if (growth.ready_at) lines.push(`наступна стадія відкриється ${new Date(growth.ready_at).toLocaleString("uk-UA")}`);
  }

  lines.push(`на поличці: ${care.water_liters} л води, ${care.compost_kg} компосту, ${care.fertilizer_kg} добрива, ${care.insecticide_bottles} інсектициду`);
  lines.push(`на складі: ${counts.items} предметів одягу${counts.listed ? `, ${counts.listed} на продажу` : ""}`);
  lines.push(`куплено напоїв за весь час: ${counts.drinks}${counts.unclaimed ? `, незабраних бонусів: ${counts.unclaimed}` : ""}`);

  if (wardrobe) {
    lines.push(wardrobe.gifted
      ? `гардероб: подарований комплект (${wardrobe.tier}), +${wardrobe.beans_awarded} зерен уже нараховано`
      : `гардероб: ${wardrobe.filled} з 5 слотів${wardrobe.tier ? `, найслабший тір ${wardrobe.tier}` : ""}`);
  }
  if (orders?.length) {
    lines.push(`замовлення: ${orders.map((o) => `${o.title} — ${o.status}`).join("; ")}`);
  }
  if (lastDrinks?.length) {
    lines.push(`останні напої: ${lastDrinks.map((d) => `${d.name} (${new Date(d.fiscal_date).toLocaleDateString("uk-UA")})`).join(", ")}`);
  }
  return lines;
}

export function systemPrompt({ plant, user, facts, knowledge }) {
  const vars = { plant_name: plant.name ?? "Кавенятко", nickname: user.nickname };
  const s = prompts.sections;
  const parts = [
    prompts.persona.map((p) => fill(p, vars)).join(" "),
    `Правила:\n${prompts.rules.map((r) => `- ${r}`).join("\n")}`,
    `${s.facts}:\n${facts.map((f) => `- ${f}`).join("\n")}`,
    `${s.economy}:\n${economyLines().map((l) => `- ${l}`).join("\n")}`,
  ];
  if (knowledge.length) {
    parts.push(`${s.knowledge}:\n${knowledge.map(({ doc }) => `### ${doc.title}\n${doc.body}`).join("\n\n")}`);
  }
  return parts.join("\n\n");
}

// Історія йде окремими репліками, а не злитим текстом: модель краще тримає
// чергу «гравець — кавенятко», коли ролі розділені.
export function buildMessages({ plant, user, facts, knowledge, history, message }) {
  return [
    { role: "system", content: systemPrompt({ plant, user, facts, knowledge }) },
    ...history.map((m) => ({ role: m.role === "plant" ? "assistant" : "user", content: m.body })),
    { role: "user", content: message },
  ];
}
