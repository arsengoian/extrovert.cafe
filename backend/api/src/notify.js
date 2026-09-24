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

// plantId — коли подія стосується конкретного куща: подяка за комплект іде
// від того, кого вдягнули, подарунок — у чат подарованого. Без нього
// вибираємо той, чий чат гравець відкривав останнім: саме туди він і
// подивиться. Досі тут завжди був найстаріший кущ, тож у гравця з трьома
// кавенятками подяка за одяг могла прийти зовсім не від того (24.09.2026).
//
// Немає жодного куща — не втрачаємо: рядок чекає в pending_notices і
// переїде в чат першого ж нового (flushNotices).
export async function notifyPlant(userId, text, { client, plantId = null } = {}) {
  const run = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);

  let target = null;
  if (plantId) {
    const { rows } = await run("select id from plants where id = $1 and owner_id = $2", [plantId, userId]);
    target = rows[0]?.id ?? null;
  }
  if (!target) {
    const { rows } = await run(
      `select id from plants where owner_id = $1
        order by chat_seen_at desc nulls last, created_at limit 1`,
      [userId]
    );
    target = rows[0]?.id ?? null;
  }

  if (!target) {
    await run("insert into pending_notices (user_id, body) values ($1, $2)", [userId, text]);
    return;
  }
  await run(
    "insert into chat_messages (plant_id, user_id, role, body) values ($1, $2, 'system', $3)",
    [target, userId, text]
  );
}

// Викликати одразу після появи куща в гравця. Порядок зберігаємо: спершу те,
// що чекало найдовше, — інакше «оплата пройшла» опиниться після «скринька
// вже на складі».
export async function flushNotices(client, userId, plantId) {
  const run = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const { rows } = await run(
    "delete from pending_notices where user_id = $1 returning body, id", [userId]
  );
  if (!rows.length) return 0;
  rows.sort((a, b) => Number(a.id) - Number(b.id));
  for (const r of rows) {
    await run(
      "insert into chat_messages (plant_id, user_id, role, body) values ($1, $2, 'system', $3)",
      [plantId, userId, r.body]
    );
  }
  return rows.length;
}
