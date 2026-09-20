// Refresh-сесія: httpOnly-кука плюс рядок у Redis (docs/services.md §3).
// Access-токен живе 15 хвилин і лежить у памʼяті застосунку; коли він
// спливає, клієнт мовчки міняє куку на новий токен. Вихід чи бан — видалити
// sess:<id>, і доступ зникне щонайбільше за ті самі 15 хвилин.
import { randomBytes } from "node:crypto";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6389");

const PLAYER_TTL_S = 30 * 24 * 60 * 60;   // 30 діб
const ADMIN_TTL_S = 12 * 60 * 60;         // 12 годин
export const COOKIE = "sid";

const key = (id) => `sess:${id}`;

export async function createSession(userId, { admin = false } = {}) {
  const id = randomBytes(24).toString("base64url");
  const ttl = admin ? ADMIN_TTL_S : PLAYER_TTL_S;
  await redis.set(key(id), JSON.stringify({ user: userId, admin, at: Date.now() }), "EX", ttl);
  return { id, ttl };
}

export async function readSession(id) {
  if (!id) return null;
  const raw = await redis.get(key(id));
  return raw ? JSON.parse(raw) : null;
}

export async function dropSession(id) {
  if (id) await redis.del(key(id));
}

// Кука ставиться на шлях /api, бо більше нікуди вона не їде. Secure лише
// поза локалкою: на http://localhost браузер таку куку просто викине.
export function sessionCookie(id, ttl, { secure = process.env.NODE_ENV === "production" } = {}) {
  const parts = [
    `${COOKIE}=${id}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ttl}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0`;

export function cookieFrom(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}
