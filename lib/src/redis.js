// Клієнт Redis для сервісів. Локально адреса з .env, у контейнері — з
// compose; порт нестандартний (6389), бо 6379 зайнятий іншим стеком.
import Redis from "ioredis";

export const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6389";

export function redisClient(options = {}) {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: 3, ...options });
}
