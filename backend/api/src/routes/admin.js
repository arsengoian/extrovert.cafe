// Роути адмінки. Сама адмінка — статика на Cloudflare Workers (admin/),
// як і застосунок гравця: окремого сервіса під неї немає й не треба, бо
// все, що вона робить, — це показ даних, які однаково живуть тут.
//
// Поки що це заглушка: один зведений показник і девелоперський вхід.
// Справжній вхід (пошта з паролем із admin_users, або той самий Google)
// зʼявиться разом із першими екранами — і тоді тут стане більше роутів, а
// не більше сервісів.
import { pool, one } from "../db.js";
import { redisClient } from "@extrovert/lib/redis.js";
import { requireAdmin, signToken } from "../auth.js";
import { verifyPassword } from "../admin-auth.js";
import { DEV } from "../env.js";
import { fail } from "../errors.js";
import { ADMIN_COOKIE, clearCookie, cookieFrom, createSession, dropSession, readSession, sessionCookie, touchSession } from "../session.js";

const redis = redisClient();
// Перебір пароля впирається в лічильник у Redis, а не в базу
// (docs/services.md §3): десять невдалих спроб на адресу — і чверть години
// пауза. Лічильник живе у вікні, тож забутий пароль не блокує назавжди.
const LOGIN_TRIES = 10;
const LOGIN_WINDOW_S = 15 * 60;

// Що написано на плашці панелі. 'none' лишає її без плашки — кіоск малює
// порожній рядок і не показує саму плашку.
async function issueAdmin(reply, admin) {
  const { id, ttl } = await createSession(admin.id, { admin: true });
  reply.header("set-cookie", sessionCookie(id, ttl, { name: ADMIN_COOKIE }));
  return {
    token: signToken(`admin:${admin.id}`, admin.role),
    admin: { id: admin.id, email: admin.email, role: admin.role },
  };
}

// Лічильники навмисно прості й незалежні один від одного: якщо котрийсь
// запит упаде (стара база, перейменована колонка), решта однаково
// покажеться — заглушка не має падати цілком через одну цифру.
const COUNTS = [
  ["players", "гравців", "select count(*)::int as n from users where deleted_at is null"],
  ["receipts_today", "чеків сьогодні", "select count(*)::int as n from receipts where created_at >= current_date"],
  ["problems_open", "скарг відкритих", "select count(*)::int as n from problem_reports where status <> 'closed'"],
  ["listings_active", "лотів на маркеті", "select count(*)::int as n from market_listings where status = 'active'"],
  ["support_waiting", "звернень без відповіді", "select count(*)::int as n from support_threads where status = 'open' and last_user_at > coalesce(last_admin_at, 'epoch')"],
  ["orders_open", "замовлень у роботі", "select count(*)::int as n from redemptions where status in ('new', 'printing', 'packing')"],
  ["quiz_week", "відповідей за тиждень", "select (select count(*) from quiz_profile_responses where created_at > now() - interval '7 days') + (select count(*) from quiz_drink_responses where created_at > now() - interval '7 days') as n"],
];

export default async function routes(app) {
  app.get("/admin/overview", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const counts = [];
    for (const [key, label, sql] of COUNTS) {
      try {
        const { rows } = await pool.query(sql);
        counts.push({ key, label, value: rows[0]?.n ?? 0 });
      } catch (e) {
        app.log.error({ err: e }, `лічильник ${key} не порахувався`);
        counts.push({ key, label, value: null });
      }
    }
    return { counts, at: new Date().toISOString() };
  });

  // Викочування меню. Адмінка лише ставить у чергу — котить scheduler
  // (backend/scheduler/src/jobs/menu.js), бо ключі до прод-бакета мають
  // бути там, де прод, а не на чиємусь ноутбуці.
  app.get("/admin/menu/deployments", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { rows } = await pool.query(
      `select d.id, d.status, d.payload, d.created_at, d.finished_at,
              count(t.id)::int as targets,
              count(*) filter (where t.status = 'done')::int as done
         from menu_deployments d
         left join menu_deployment_targets t on t.deployment_id = d.id
        group by d.id
        order by d.id desc
        limit 10`
    );
    return { deployments: rows };
  });

  app.post("/admin/menu/deployments", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    // Акції тут немає навмисно: деплоймент — це про ціни, які треба
    // довезти до машини й Checkbox. Поточну акцію меню бере саме собою
    // (lib/menu.js), і міняється вона окремою дією в адмінці.
    const points = Array.isArray(req.body?.points) && req.body.points.length
      ? req.body.points
      : (await pool.query("select id from points order by id")).rows.map((r) => r.id);
    if (!points.length) return reply.code(400).send({ error: "no_points" });

    const deployment = await one(
      `insert into menu_deployments (payload, status, created_by)
       values ($1, 'queued', $2) returning id, status, created_at`,
      // У payload лишається слід того, що саме котили: ціни на момент
      // викочування вже в drinks, а тут — привід.
      [JSON.stringify({ reason: "prices" }), admin.id]
    );
    for (const point of points) {
      await pool.query(
        "insert into menu_deployment_targets (deployment_id, kind, point_id) values ($1, 'r2', $2)",
        [deployment.id, point]
      );
    }
    return { ...deployment, points };
  });

  // Вхід адміна: пошта й пароль із admin_users. Форми «зареєструватися»
  // немає ніде — адміна заводить scripts/admin.mjs.
  app.post("/admin/login", async (req, reply) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email || !password) fail(400, "bad_credentials");

    const key = `admin:login:fail:${email}`;
    if (Number(await redis.get(key)) >= LOGIN_TRIES) fail(429, "too_many_tries");

    const admin = await one("select * from admin_users where email = $1", [email]);
    // Однакова відповідь на «немає такого» й «пароль не той»: інакше форма
    // входу розповідала б, які адреси заведені.
    const ok = admin && !admin.disabled_at && (await verifyPassword(password, admin.password_hash));
    if (!ok) {
      await redis.multi().incr(key).expire(key, LOGIN_WINDOW_S).exec();
      fail(401, "bad_credentials");
    }
    await redis.del(key);
    await pool.query("update admin_users set last_login_at = now() where id = $1", [admin.id]);
    return issueAdmin(reply, admin);
  });

  // Обмін куки на свіжий токен — і заразом продовження сесії: тиждень від
  // цієї миті (session.js). Куку теж переставляємо, інакше браузер викине
  // її за старим Max-Age, хоч у Redis сесія ще жива, — і вхід питали б за
  // розкладом, як і раніше.
  app.post("/admin/refresh", async (req, reply) => {
    const sid = cookieFrom(req, ADMIN_COOKIE);
    const session = await readSession(sid);
    if (!session?.admin) {
      reply.header("set-cookie", clearCookie(ADMIN_COOKIE));
      return reply.code(401).send({ error: "no_session" });
    }
    const admin = await one("select id, email, role, disabled_at from admin_users where id = $1", [session.user]);
    // Вимкнений адмін не оновлює сесію: доступ зникає за ≤15 хвилин.
    if (!admin || admin.disabled_at) {
      await dropSession(sid);
      reply.header("set-cookie", clearCookie(ADMIN_COOKIE));
      return reply.code(401).send({ error: "disabled" });
    }
    const ttl = await touchSession(sid, session);
    if (!ttl) {
      reply.header("set-cookie", clearCookie(ADMIN_COOKIE));
      return reply.code(401).send({ error: "no_session" });
    }
    reply.header("set-cookie", sessionCookie(sid, ttl, { name: ADMIN_COOKIE }));
    return {
      token: signToken(`admin:${admin.id}`, admin.role),
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  });

  app.post("/admin/logout", async (req, reply) => {
    await dropSession(cookieFrom(req, ADMIN_COOKIE));
    reply.header("set-cookie", clearCookie(ADMIN_COOKIE));
    return { ok: true };
  });

  // Девелоперський вхід в адмінку — рівно як /auth/dev для гравця й з тією
  // самою умовою (env.js): у проді його немає.
  app.post("/admin/dev-login", async (req, reply) => {
    if (!DEV) return reply.code(404).send({ error: "not_found" });

    const admin =
      (await one("select * from admin_users where email = $1", ["dev@extrovert.cafe"])) ||
      (await one(
        `insert into admin_users (email, role) values ($1, 'owner') returning *`,
        ["dev@extrovert.cafe"]
      ));

    // Сесія така сама, як у справжнього входу: перезавантаження сторінки
    // локально не має викидати на екран входу.
    return issueAdmin(reply, admin);
  });
}
