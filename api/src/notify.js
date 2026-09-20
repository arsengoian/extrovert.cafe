// Сповіщення гравцю. Пушів ми не робимо свідомо (gamification_ui §MVP),
// тому єдиний канал — системна репліка в чаті кавенятка: продаж на маркеті,
// нарахування, зміна статусу замовлення, новини.
//
// Живе окремо від роутів чату, щоб інші роути не імпортували роут.
import { query } from "./db.js";

// Українська множина потрібна вже тут: «нараховано 3 зерен» видно гравцю.
export function plural(n, one, few, many) {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const beansWord = (n) => `${n} ${plural(n, "зерно", "зерна", "зерен")}`;

export async function notifyPlant(userId, text, { client } = {}) {
  const run = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const { rows } = await run("select id from plants where owner_id = $1 order by created_at limit 1", [userId]);
  if (!rows.length) return;
  await run(
    "insert into chat_messages (plant_id, user_id, role, body) values ($1, $2, 'system', $3)",
    [rows[0].id, userId, text]
  );
}
