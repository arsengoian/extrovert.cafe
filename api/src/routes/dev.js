// Девелоперські роути: існують лише поза продом. Через них скрипти
// розробника штовхають події, поки немає scheduler з публікатором outbox
// (roadmap, крок 0-біс).
import { redisClient } from "@extrovert/lib/redis.js";
import { requireUser } from "../auth.js";

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";
const redis = DEV ? redisClient() : null;

export default async function routes(app) {
  if (!DEV) return;

  // Надіслати подію в канал гравця: так перевіряється ланцюжок
  // api → redis → ws → застосунок без справжнього продажу.
  app.post("/dev/publish", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const event = req.body?.event ?? "ping";
    const payload = JSON.stringify({ event, payload: req.body?.payload ?? {}, at: new Date().toISOString() });
    await redis.publish(`user:${user.id}`, payload);
    return { published: true, channel: `user:${user.id}`, event };
  });
}
