// REST для застосунку гравця. Схема — db/migrations, економіка —
// backend/api/data/economy.json, контент — db/seeds (docs/db-schema.md §7).
import Fastify from "fastify";
import { onShutdown } from "@extrovert/lib/shutdown.js";
import { closeRedis } from "@extrovert/lib/redis.js";
import { pool } from "./db.js";
import { ephemeralKey } from "./auth.js";
import { DEV } from "./env.js";
import { registerErrorHandler } from "./errors.js";
import authRoutes from "./routes/auth.js";
import meRoutes, { nicknameRoutes } from "./routes/me.js";
import catalogRoutes from "./routes/catalog.js";
import shopRoutes from "./routes/shop.js";
import plantRoutes from "./routes/plants.js";
import crateRoutes from "./routes/crate.js";
import devRoutes from "./routes/dev.js";
import problemRoutes from "./routes/problems.js";
import quizRoutes from "./routes/quiz.js";
import repostRoutes from "./routes/repost.js";
import plantingRoutes from "./routes/planting.js";
import wardrobeRoutes from "./routes/wardrobe.js";
import chatRoutes from "./routes/chat.js";
import purchaseRoutes from "./routes/purchases.js";
import marketRoutes from "./routes/market.js";
import walletRoutes from "./routes/wallet.js";
import legalRoutes from "./routes/legal.js";
import deliveryRoutes from "./routes/delivery.js";
import accountRoutes from "./routes/account.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes from "./routes/payments.js";
import supportRoutes from "./routes/support.js";
import { ensureWebhook } from "./support/telegram.js";

const app = Fastify({ logger: true });
registerErrorHandler(app);

// Тіло потрібне байт-у-байт: підпис вебхука mono рахується від сирого
// тексту, а перезібраний JSON відрізняється пробілами й порядком ключів.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  req.rawBody = body;
  if (!body) return done(null, {});
  try { done(null, JSON.parse(body)); } catch (e) { done(e); }
});

// Клієнт живе на extrovert.cafe, api на піддомені; локально — різні порти.
// Дозволяємо лише те, що справді ходить: інакше CORS перетворюється на
// прикрасу. localhost — тільки поза продом: у проді сторінці з чужої
// машини говорити з нашим api нема чого.
//
// allow-credentials обовʼязковий: клієнт шле кожен запит із
// credentials: "include" (кука сесії для /auth/refresh), і без цього
// заголовка браузер відкидає відповідь цілком. Локально цього не видно —
// там клієнт ходить через проксі Vite з того самого origin.
const ORIGINS = DEV
  ? /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(extrovert|admin\.extrovert)\.cafe)$/
  : /^https:\/\/(extrovert|admin\.extrovert)\.cafe$/;
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.test(origin)) {
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-credentials", "true");
    reply.header("vary", "origin");
    reply.header("access-control-allow-headers", "authorization,content-type");
    reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") reply.code(204).send();
});

app.get("/healthz", async () => ({ ok: true }));

await app.register(authRoutes, { prefix: "/api/v1" });
await app.register(meRoutes, { prefix: "/api/v1" });
await app.register(nicknameRoutes, { prefix: "/api/v1" });
await app.register(catalogRoutes, { prefix: "/api/v1" });
await app.register(shopRoutes, { prefix: "/api/v1" });
await app.register(plantRoutes, { prefix: "/api/v1" });
await app.register(crateRoutes, { prefix: "/api/v1" });
await app.register(devRoutes, { prefix: "/api/v1" });
await app.register(problemRoutes, { prefix: "/api/v1" });
await app.register(quizRoutes, { prefix: "/api/v1" });
await app.register(repostRoutes, { prefix: "/api/v1" });
await app.register(plantingRoutes, { prefix: "/api/v1" });
await app.register(wardrobeRoutes, { prefix: "/api/v1" });
await app.register(chatRoutes, { prefix: "/api/v1" });
await app.register(purchaseRoutes, { prefix: "/api/v1" });
await app.register(marketRoutes, { prefix: "/api/v1" });
await app.register(walletRoutes, { prefix: "/api/v1" });
await app.register(legalRoutes, { prefix: "/api/v1" });
await app.register(deliveryRoutes, { prefix: "/api/v1" });
await app.register(accountRoutes, { prefix: "/api/v1" });
await app.register(adminRoutes, { prefix: "/api/v1" });
await app.register(paymentRoutes, { prefix: "/api/v1" });
await app.register(supportRoutes, { prefix: "/api/v1" });

const port = Number(process.env.PORT || 3001);
try {
  await pool.query("select 1");
  // Тимчасовий ключ — зручність для локалки. У проді він означав би, що
  // кожен рестарт розлогінює всіх, а під час викочування дві копії api
  // підписують різними ключами й не визнають токенів одна одної. Краще не
  // стартувати зовсім: rollout.sh лишить стару версію працювати.
  if (ephemeralKey && !DEV) throw new Error("JWT_PRIVATE_KEY не заданий — у проді api без нього не стартує");
  if (ephemeralKey) app.log.warn("JWT_PRIVATE_KEY не заданий — ключ згенеровано на час процесу, рестарт розлогінить усіх");
  if (DEV) app.log.warn("DEV: девелоперський вхід, тестова оплата й /dev/* увімкнені (env.js)");
  await app.listen({ port, host: "0.0.0.0" });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}

// Вебхук бота підтримки реєструється сам — лише в проді, бо локально
// Telegram до нас не достукається. Ідемпотентно: якщо адреса та сама,
// нічого не міняється. Не вийшло — api працює далі, бот просто мовчить.
if (process.env.APP_ENV === "production") {
  ensureWebhook({ log: app.log })
    .then((r) => app.log.info(r, "вебхук бота підтримки"))
    .catch((e) => app.log.warn({ err: e.message }, "вебхук бота підтримки не зареєструвався"));
}

// Під час деплою поруч уже стоїть новий контейнер, а цей має доробити те,
// що встиг узяти. app.close() перестає приймати зʼєднання й чекає на
// відповіді в польоті — саме через нього транзакція не обривається
// посередині. Пул закривається останнім: до нього ходять ті самі запити.
onShutdown(
  {
    "http": () => app.close(),
    "redis": () => closeRedis(),
    "postgres": () => pool.end(),
  },
  { log: app.log, timeoutMs: 25_000 }
);
