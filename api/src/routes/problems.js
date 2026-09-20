// «Що не працює?» — скарги й ідеї з застосунку (gamification_ui.md).
// Категорії — фіксований набір із дизайну; текст і фото необовʼязкові,
// але щось одне має бути, інакше це порожній рядок у черзі адмінки.
import { many, one } from "../db.js";
import { userFromRequest } from "../auth.js";

export const CATEGORIES = ["coffee_machine", "monitor", "site", "supplies", "idea"];

export default async function routes(app) {
  // Точка, до якої прив'язана скарга. Поки точка одна — віддаємо активну;
  // коли їх стане більше, сюди прийде та, з чийого QR гравець зайшов
  // (users.metadata.qr_pos, urls.md).
  app.get("/points/current", async () => {
    const point = await one(
      `select id, name, address from points
        where status in ('live', 'planned') order by status, id limit 1`
    );
    return { point };
  });

  app.post("/problems", async (req, reply) => {
    const user = userFromRequest(req);            // скаргу можна лишити й без входу
    const categories = Array.isArray(req.body?.categories)
      ? req.body.categories.filter((c) => CATEGORIES.includes(c))
      : [];
    const body = String(req.body?.body ?? "").trim().slice(0, 4000);
    const pointId = req.body?.point_id ?? null;

    if (!categories.length && !body) {
      return reply.code(400).send({ error: "empty_report" });
    }

    const row = await one(
      `insert into problem_reports (user_id, point_id, categories, body)
       values ($1, $2, $3, $4) returning id, created_at`,
      [user?.id ?? null, pointId, categories, body || null]
    );
    return { id: row.id, created_at: row.created_at };
  });

  // Свої скарги — щоб екран міг показати «ми отримали» без окремого стану.
  app.get("/me/problems", async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) return { reports: [] };
    const rows = await many(
      `select id, categories, body, status, created_at from problem_reports
        where user_id = $1 order by created_at desc limit 20`,
      [user.id]
    );
    return { reports: rows };
  });
}
