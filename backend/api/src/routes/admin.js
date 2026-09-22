// Роути адмінки. Сама адмінка — статика на Cloudflare Workers (admin/),
// як і застосунок гравця: окремого сервіса під неї немає й не треба, бо
// все, що вона робить, — це показ даних, які однаково живуть тут.
//
// Поки що це заглушка: один зведений показник і девелоперський вхід.
// Справжній вхід (пошта з паролем із admin_users, або той самий Google)
// зʼявиться разом із першими екранами — і тоді тут стане більше роутів, а
// не більше сервісів.
import { pool, one } from "../db.js";
import { requireAdmin, signToken } from "../auth.js";
import { DEV } from "../env.js";

const ADMIN_TOKEN_TTL_S = 12 * 60 * 60;

// Лічильники навмисно прості й незалежні один від одного: якщо котрийсь
// запит упаде (стара база, перейменована колонка), решта однаково
// покажеться — заглушка не має падати цілком через одну цифру.
const COUNTS = [
  ["players", "гравців", "select count(*)::int as n from users where deleted_at is null"],
  ["receipts_today", "чеків сьогодні", "select count(*)::int as n from receipts where created_at >= current_date"],
  ["problems_open", "скарг відкритих", "select count(*)::int as n from problem_reports where status <> 'closed'"],
  ["listings_active", "лотів на маркеті", "select count(*)::int as n from market_listings where status = 'active'"],
  ["support_waiting", "звернень без відповіді", "select count(*)::int as n from support_threads where status = 'open' and last_user_at > coalesce(last_admin_at, 'epoch')"],
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

    // Акція їде разом із деплойментом: у payload видно, що саме викотили й
    // коли, а не лише «десь змінили файл». Якщо її не передали — беремо з
    // попереднього викочування: зміна цін не має вимагати переписувати
    // текст акції щоразу.
    let ad = req.body?.ad ?? null;
    if (!ad) {
      const last = await one(
        `select payload from menu_deployments
          where payload ? 'ad' and status in ('done', 'partial')
          order by id desc limit 1`
      );
      ad = last?.payload?.ad ?? null;
    }

    const points = Array.isArray(req.body?.points) && req.body.points.length
      ? req.body.points
      : (await pool.query("select id from points order by id")).rows.map((r) => r.id);
    if (!points.length) return reply.code(400).send({ error: "no_points" });

    const deployment = await one(
      `insert into menu_deployments (payload, status, created_by)
       values ($1, 'queued', $2) returning id, status, created_at`,
      [JSON.stringify(ad ? { ad } : {}), admin.id]
    );
    for (const point of points) {
      await pool.query(
        "insert into menu_deployment_targets (deployment_id, kind, point_id) values ($1, 'r2', $2)",
        [deployment.id, point]
      );
    }
    return { ...deployment, points, ad };
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

    // Куки тут немає навмисно: оновлювати цей токен нікому, а 12 годин —
    // це рівно одна зміна. Коли зʼявиться справжній вхід, разом із ним
    // прийде й сесія (session.js уже вміє admin-сесії).
    return {
      token: signToken(`admin:${admin.id}`, "owner", {}, ADMIN_TOKEN_TTL_S),
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  });
}
