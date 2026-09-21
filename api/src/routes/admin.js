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

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";
const ADMIN_TOKEN_TTL_S = 12 * 60 * 60;

// Лічильники навмисно прості й незалежні один від одного: якщо котрийсь
// запит упаде (стара база, перейменована колонка), решта однаково
// покажеться — заглушка не має падати цілком через одну цифру.
const COUNTS = [
  ["players", "гравців", "select count(*)::int as n from users where deleted_at is null"],
  ["receipts_today", "чеків сьогодні", "select count(*)::int as n from receipts where created_at >= current_date"],
  ["problems_open", "скарг відкритих", "select count(*)::int as n from problem_reports where status <> 'closed'"],
  ["listings_active", "лотів на маркеті", "select count(*)::int as n from market_listings where status = 'active'"],
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

  // Девелоперський вхід в адмінку — рівно як /auth/dev для гравця й з тією
  // самою умовою: поза local його немає.
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
