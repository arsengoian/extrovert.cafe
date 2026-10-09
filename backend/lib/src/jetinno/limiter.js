// Темп запитів до чужого порталу Jetinno: не більш як rps на секунду, спільно
// для всіх процесів через Redis (docs/jetinno.md, «Скоуп інтеграції», крок 0).
// Один ключ тримає позначку «коли звільниться наступний слот»; кожен запит
// атомарно (Lua) зсуває її на інтервал і повертає, скільки треба зачекати.
// Так навіть збіг кількох робіт не дає сплеску, а портал бачить рівний темп.
import { redisClient } from "../redis.js";

// Час беремо з самого Redis (`TIME`), а не з процесів: годинники на різних
// машинах розходяться, а слоти мають бути спільні.
const SCRIPT = `
local key = KEYS[1]
local interval = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local next_at = tonumber(redis.call('GET', key) or '0')
local slot = now
if next_at > now then slot = next_at end
redis.call('SET', key, slot + interval, 'PX', ttl)
return slot - now
`;

export function rateLimiter({ redis, key = "jetinno:rl", rps = Number(process.env.JETINNO_MAX_RPS) || 2 } = {}) {
  const client = redis ?? redisClient();
  const interval = Math.ceil(1000 / rps);
  const ttl = Math.max(interval * 4, 2000);
  return async function wait() {
    const waitMs = Number(await client.eval(SCRIPT, 1, key, interval, ttl));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  };
}
