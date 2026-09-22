// Refresh-сесія: httpOnly-кука плюс рядок у Redis (docs/services.md §3).
// Access-токен живе 15 хвилин і лежить у памʼяті застосунку; коли він
// спливає, клієнт мовчки міняє куку на новий токен. Вихід чи бан — видалити
// sess:<id>, і доступ зникне щонайбільше за ті самі 15 хвилин.
//
// Сесія гравця ковзна: кожне оновлення токена відсуває її кінець на
// PLAYER_IDLE_S від «зараз» — і в Redis, і в куці. Хто заходить хоч раз на
// пів року, не вилітає з акаунта ніколи; вилогінює лише неактивність.
// Раніше сесія жила 30 діб від входу, хоч би як часто людина грала.
import { randomBytes } from "node:crypto";
import { redisClient } from "@extrovert/lib/redis.js";
import { PROD } from "./env.js";

// Клієнт із lib, а не свій: так зупинка сервіса закриває його разом з усіма
// іншими, не знаючи про цей модуль.
const redis = redisClient();

const PLAYER_IDLE_S = 180 * 24 * 60 * 60;   // 180 діб без жодного оновлення
const ADMIN_TTL_S = 12 * 60 * 60;           // 12 годин і не продовжується
export const COOKIE = "sid";

const key = (id) => `sess:${id}`;
// Усі сесії гравця: видалення акаунта має гасити вхід на кожному пристрої,
// а не лише на тому, з якого натиснули кнопку. У id сесії двокрапки не
// буває (base64url), тож із цим ключем він не перетнеться.
const userKey = (userId) => `sess:user:${userId}`;

export async function createSession(userId, { admin = false } = {}) {
  const id = randomBytes(24).toString("base64url");
  const ttl = admin ? ADMIN_TTL_S : PLAYER_IDLE_S;
  const now = Date.now();
  const tx = redis.multi().set(key(id), JSON.stringify({ user: userId, admin, at: now, seen: now }), "EX", ttl);
  if (!admin) tx.sadd(userKey(userId), id).expire(userKey(userId), PLAYER_IDLE_S);
  await tx.exec();
  return { id, ttl };
}

export async function readSession(id) {
  if (!id) return null;
  const raw = await redis.get(key(id));
  return raw ? JSON.parse(raw) : null;
}

// Продовжити сесію гравця ще на PLAYER_IDLE_S. Повертає новий термін для
// куки або null, якщо сесії вже немає. XX — лише якщо ключ іще існує: вихід,
// що стався між читанням і продовженням, не має воскресити сесію.
export async function touchSession(id, session) {
  if (session.admin) return null;
  const [[, ok]] = await redis.multi()
    .set(key(id), JSON.stringify({ ...session, seen: Date.now() }), "EX", PLAYER_IDLE_S, "XX")
    .expire(userKey(session.user), PLAYER_IDLE_S)
    .exec();
  return ok === "OK" ? PLAYER_IDLE_S : null;
}

export async function dropSession(id) {
  if (!id) return;
  const session = await readSession(id);
  const tx = redis.multi().del(key(id));
  if (session?.user && !session.admin) tx.srem(userKey(session.user), id);
  await tx.exec();
}

export async function dropUserSessions(userId) {
  const ids = await redis.smembers(userKey(userId));
  await redis.del(userKey(userId), ...ids.map(key));
}

// Кука ставиться на шлях /api, бо більше нікуди вона не їде. Secure лише
// поза локалкою: на http://localhost браузер таку куку просто викине.
export function sessionCookie(id, ttl, { secure = PROD } = {}) {
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
