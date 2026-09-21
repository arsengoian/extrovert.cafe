// Клієнт Redis для сервісів. Локально адреса з .env, у контейнері — з
// compose; порт нестандартний (6389), бо 6379 зайнятий іншим стеком.
import Redis from "ioredis";

export const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6389";

// Усі створені клієнти тримаються тут, щоб зупинка сервіса могла закрити їх
// усі одним викликом. Інакше кожен модуль, який завів собі зʼєднання,
// мусив би ще й пробросити його до обробника SIGTERM — і один забутий
// клієнт тримає процес живим до самого SIGKILL.
const clients = new Set();

export function redisClient(options = {}) {
  const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, ...options });
  clients.add(client);
  client.once("end", () => clients.delete(client));
  return client;
}

// quit(), а не disconnect(): дає дописати команду, яка вже в польоті.
export async function closeRedis() {
  await Promise.all([...clients].map((c) => c.quit().catch(() => {})));
  clients.clear();
}
