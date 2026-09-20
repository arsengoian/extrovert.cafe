// Вхід. У проді це Google/Apple (docs/services.md §3); поки їх немає,
// працює лише девелоперський вхід, і він вимкнений скрізь, крім local.
import { randomUUID } from "node:crypto";
import { one } from "../db.js";
import { signToken } from "../auth.js";
import { generateNickname } from "../nickname.js";

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";

export default async function routes(app) {
  // Девелоперський вхід: створює гравця з metadata.dev = true, щоб скрипти
  // розробника мали право його чіпати (roadmap, крок 0-біс).
  app.post("/auth/dev", async (req, reply) => {
    if (!DEV) return reply.code(404).send({ error: "not_found" });
    const nickname = (req.body?.nickname || "").trim() || (await generateNickname());

    const existing = await one("select * from users where nickname = $1", [nickname]);
    const user =
      existing ||
      (await one(
        `insert into users (id, nickname, metadata, consent_at, terms_version)
         values ($1, $2, '{"dev": true}'::jsonb, now(), 'dev')
         returning *`,
        [randomUUID(), nickname]
      ));

    return {
      token: signToken(`user:${user.id}`, "player"),
      user: { id: user.id, nickname: user.nickname },
    };
  });
}
