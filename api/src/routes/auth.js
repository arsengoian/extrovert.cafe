// Вхід і оновлення сесії. У проді вхід буде через Google/Apple
// (docs/services.md §3); поки їх немає, працює девелоперський вхід — і він
// вимкнений скрізь, крім local.
import { randomUUID } from "node:crypto";
import { one } from "../db.js";
import { signToken } from "../auth.js";
import { generateNickname } from "../nickname.js";
import { clearCookie, cookieFrom, createSession, dropSession, readSession, sessionCookie } from "../session.js";

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";

async function issue(reply, user) {
  const { id, ttl } = await createSession(user.id);
  reply.header("set-cookie", sessionCookie(id, ttl));
  return {
    token: signToken(`user:${user.id}`, "player"),
    user: { id: user.id, nickname: user.nickname },
  };
}

export default async function routes(app) {
  // Девелоперський вхід: створює гравця з metadata.dev = true, щоб скрипти
  // розробника мали право його чіпати (roadmap, крок 0-біс).
  app.post("/auth/dev", async (req, reply) => {
    if (!DEV) return reply.code(404).send({ error: "not_found" });
    const nickname = (req.body?.nickname || "").trim() || (await generateNickname());

    const existing = await one("select * from users where nickname = $1 and deleted_at is null", [nickname]);
    // Нікнейм міг лишитись за видаленим акаунтом: увійти в нього не можна,
    // але й зайняти його ім'я теж — тоді видаємо нове, замість падати на
    // унікальному індексі.
    const free = existing
      ? nickname
      : (await one("select 1 from users where nickname = $1", [nickname]))
        ? await generateNickname()
        : nickname;

    const user =
      existing ||
      (await one(
        `insert into users (id, nickname, metadata, consent_at, terms_version)
         values ($1, $2, '{"dev": true}'::jsonb, now(), 'dev')
         returning *`,
        [randomUUID(), free]
      ));

    return issue(reply, user);
  });

  // Обмін куки на свіжий access-токен. Клієнт кличе це сам, коли впіймав
  // 401: для гравця оновлення сесії має бути непомітним.
  app.post("/auth/refresh", async (req, reply) => {
    const sid = cookieFrom(req);
    const session = await readSession(sid);
    if (!session) {
      reply.header("set-cookie", clearCookie());
      return reply.code(401).send({ error: "no_session" });
    }
    const user = await one("select id, nickname from users where id = $1", [session.user]);
    if (!user) {
      await dropSession(sid);
      reply.header("set-cookie", clearCookie());
      return reply.code(401).send({ error: "no_such_user" });
    }
    return {
      token: signToken(`user:${user.id}`, "player"),
      user: { id: user.id, nickname: user.nickname },
    };
  });

  app.post("/auth/logout", async (req, reply) => {
    await dropSession(cookieFrom(req));
    reply.header("set-cookie", clearCookie());
    return { ok: true };
  });
}
