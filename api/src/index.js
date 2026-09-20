// REST для застосунку гравця. Схема — db/migrations, економіка —
// api/data/economy.json, контент — db/seeds (docs/db-schema.md §7).
import Fastify from "fastify";
import { pool } from "./db.js";
import { ephemeralKey } from "./auth.js";
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

const app = Fastify({ logger: true });
registerErrorHandler(app);

// Клієнт живе на extrovert.cafe, api на піддомені; локально — різні порти.
// Дозволяємо лише те, що справді ходить: інакше CORS перетворюється на
// прикрасу.
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/extrovert\.cafe)$/.test(origin)) {
    reply.header("access-control-allow-origin", origin);
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

const port = Number(process.env.PORT || 3001);
try {
  await pool.query("select 1");
  if (ephemeralKey) app.log.warn("JWT_PRIVATE_KEY не заданий — ключ згенеровано на час процесу, рестарт розлогінить усіх");
  await app.listen({ port, host: "0.0.0.0" });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
