// Власний збір подій (власник, 02.10.2026): кожен запит до api і кожна
// навігація в застосунку гравця. Запит не чекає на базу — подія лягає в
// Redis-список, а scheduler раз на хвилину переносить його в
// analytics_events пачкою й рахує відра для дашборду (jobs/analytics.js).
//
// Що пишемо — рівно аналітичне мінімальне: user_id (якщо увійшов), ip,
// тип і payload. Для api — метод, ШАБЛОН маршруту (/me/plants/:id, а не
// id), статус і час відповіді; ні тіл, ні рядка запиту. Для nav — екран,
// попередній екран і клас пристрою (ios/android/desktop), а не сам
// user-agent.
import { redisClient } from "@extrovert/lib/redis.js";
import { verifyToken } from "./auth.js";
import { clientIp } from "./ip.js";

export const ANALYTICS_KEY = "analytics:events";
// Стеля черги: якщо scheduler лежить, Redis не має з'їсти памʼять. Пів
// мільйона подій — це кілька годин живого трафіку; далі найстаріші
// відкидаються.
const MAX_QUEUE = 500_000;

const redis = redisClient();

// Чия подія: гравець із токена, навіть щойно простроченого (доба запасу) —
// інакше кожен 401 перед оновленням токена записувався б «гостем». Підпис
// перевіряється як завжди; адмінський токен — не гравець.
const ATTRIBUTION_GRACE_S = 24 * 3600;
const userIdOf = (token) => {
  const claims = token ? verifyToken(token, ATTRIBUTION_GRACE_S) : null;
  return claims && String(claims.sub).startsWith("user:") ? String(claims.sub).slice(5) : null;
};
const bearer = (req) => {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

export function track(event) {
  redis.pipeline()
    .rpush(ANALYTICS_KEY, JSON.stringify(event))
    .ltrim(ANALYTICS_KEY, -MAX_QUEUE, -1)
    .exec()
    .catch(() => { /* аналітика ніколи не валить запит */ });
}

// Не записуємо: preflight, проба здоровʼя й сам прийом навігації (інакше
// кожна пачка nav-подій давала б ще й api-подію про себе).
const SKIP = new Set(["/healthz", "/api/v1/events"]);

export function registerAnalytics(app) {
  app.addHook("onResponse", async (req, reply) => {
    if (req.method === "OPTIONS") return;
    // Шаблон маршруту; невідомий маршрут (сканери, 404 повз роути) — не
    // аналітика застосунку, а шум.
    const route = req.routeOptions?.url;
    if (!route || SKIP.has(route)) return;
    track({
      at: Date.now(),
      user_id: userIdOf(bearer(req)),
      ip: clientIp(req),
      type: "api",
      payload: {
        method: req.method,
        route: route.replace(/^\/api\/v1/, ""),
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime ?? 0),
      },
    });
  });
}

// Клас пристрою з user-agent — лише він, не рядок цілком.
export function platformOf(ua = "") {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "other";
}

const SCREEN = /^[A-Za-z][A-Za-z0-9_:/-]{0,39}$/;
// Точка в ?p= QR: «1» на наклейці, «kyiv-01» у бонусі кіоска (docs/urls.md).
export const QR_POS = /^[A-Za-z0-9_-]{1,16}$/;
const screenOf = (v) => (typeof v === "string" && SCREEN.test(v) ? v : null);

// UTM-мітки посилання (client/src/utm.js, власник 24.10.2026): короткий
// текст без службових символів, як і на клієнті; click — лише назва мережі,
// сам fbclid/gclid ми не беремо.
const UTM_FIELDS = ["source", "medium", "campaign", "content", "term"];
const UTM_CLICKS = new Set(["fb", "google", "tiktok"]);
export function utmOf(e) {
  const out = {};
  for (const f of UTM_FIELDS) {
    const s = String(e?.[f] ?? "").trim().toLowerCase();
    if (s && s.length <= 64 && /^[\p{L}\p{N} _.+-]+$/u.test(s)) out[f] = s;
  }
  if (UTM_CLICKS.has(e?.click)) out.click = e.click;
  return Object.keys(out).length ? out : null;
}

// Навігація з фронтенду: застосунок шле пачку раз на кілька секунд (і
// при згортанні вкладки). Хто й звідки — визначаємо ми: user_id лише з
// підписаного токена, адреса — з X-Real-IP, а не з полів тіла, тож
// підробити чужу подію не вийде. ago —
// скільки мілісекунд тому подія сталась: час рахуємо від свого годинника,
// а не від годинника телефона.
export default async function routes(app) {
  app.post("/events", async (req, reply) => {
    // Застосунок шле text/plain (простий запит без preflight — див.
    // client/src/analytics.js), тож тіло може прийти рядком, а токен — у ньому.
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const list = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
    const userId = userIdOf(typeof body?.token === "string" ? body.token : bearer(req));
    const ip = clientIp(req);
    const platform = platformOf(req.headers["user-agent"]);
    const now = Date.now();
    for (const e of list) {
      const ago = Math.min(Math.max(0, Number(e?.ago) || 0), 10 * 60_000);
      // Застосунок відкрили з QR (client/src/qr.js): точка з ?p= і звідки —
      // наклейка на автоматі чи QR бонусу на кіоску. Рахуємо тут, а не у
      // воркері qr.*: туди ходять перевірка здоровʼя й боти, а JavaScript
      // виконує лише людина з телефоном (12.10.2026).
      if (e?.type === "qr") {
        const pos = typeof e.pos === "string" && QR_POS.test(e.pos) ? e.pos : null;
        if (!pos) continue;
        track({
          at: now - ago,
          user_id: userId,
          ip,
          type: "qr",
          payload: { pos, via: e.via === "bonus" ? "bonus" : "sticker", platform },
        });
        continue;
      }
      // Застосунок відкрили за посиланням з UTM-мітками — кожен такий захід
      // (client/src/utm.js); в акаунт мітки пише окремо POST /me/utm.
      if (e?.type === "utm") {
        const utm = utmOf(e);
        if (utm) track({ at: now - ago, user_id: userId, ip, type: "utm", payload: { ...utm, platform } });
        continue;
      }
      if (e?.type !== "nav") continue;
      const screen = screenOf(e.screen);
      if (!screen) continue;
      const from = screenOf(e.from);
      track({
        at: now - ago,
        user_id: userId,
        ip,
        type: "nav",
        payload: { screen, ...(from ? { from } : {}), platform },
      });
    }
    return reply.code(204).send();
  });
}
