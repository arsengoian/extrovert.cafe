// Публікатор outbox: рядок у Postgres → канал Redis → ws → кіоск і телефон.
//
// Чому не PUBLISH одразу з api: подія має зʼявитись у тій самій транзакції,
// що й зміна, яку вона описує. Публікація — окремий крок, і саме тому вона
// живе тут (db-schema §0).
import { drain } from "@extrovert/lib/outbox.js";

export async function publishOutbox({ pool, redis, log }) {
  const sent = await drain(pool, redis, { limit: 200, log });
  return sent ? { done: `опубліковано подій: ${sent}` } : {};
}
