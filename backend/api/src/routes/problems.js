// «Що не працює?» — скарги й ідеї з застосунку (gamification_ui.md).
// Категорії — фіксований набір із дизайну; текст і фото необовʼязкові,
// але щось одне має бути, інакше це порожній рядок у черзі адмінки.
import { many, one } from "../db.js";
import { userFromRequest } from "../auth.js";
import { fail } from "../errors.js";
import { bucketFor, presign } from "@extrovert/lib/r2.js";

export const CATEGORIES = ["coffee_machine", "monitor", "site", "supplies", "idea"];

// Фото зі скарги лежать в окремому бакеті (uploads), а не разом із кадрами
// з камер (evidence): це чужі персональні дані, з іншим строком зберігання
// й іншим правом доступу — гравець пише, адмінка читає.
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export default async function routes(app) {
  // Точка, до якої прив'язана скарга. Поки точка одна — віддаємо активну;
  // коли їх стане більше, сюди прийде та, з чийого QR гравець зайшов
  // (users.metadata.qr_pos, urls.md).
  app.get("/points/current", async () => {
    const point = await one(
      `select id, name, address, short_address from points
        where status in ('live', 'planned') order by status, id limit 1`
    );
    return { point };
  });

  // Телефон заливає фото САМ, за підписаним посиланням: кілька мегабайтів
  // через api не мають сенсу, а підпис живе хвилини — переслати «на потім»
  // його не вийде.
  app.post("/problems/photo-url", async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) fail(401, "unauthorized");        // анонімну скаргу лишаємо без фото
    const type = String(req.body?.content_type ?? "");
    const size = Number(req.body?.size ?? 0);
    const ext = PHOTO_TYPES[type];
    if (!ext) fail(400, "bad_type", { allowed: Object.keys(PHOTO_TYPES) });
    if (!(size > 0) || size > PHOTO_MAX_BYTES) fail(400, "too_big", { max: PHOTO_MAX_BYTES });

    // Ключ із id гравця й датою: за префіксом видно, чиє фото й коли, а
    // випадкова частина не дає вгадати чужий ключ.
    const day = new Date().toISOString().slice(0, 10);
    const key = `problems/${day}/${user.id}/${crypto.randomUUID()}.${ext}`;
    const link = presign({ method: "PUT", purpose: "uploads", key, contentType: type, expiresIn: 600 });
    return { upload_url: link.url, key: link.key, bucket: link.bucket, expires_in: link.expires_in };
  });

  app.post("/problems", async (req, reply) => {
    const user = userFromRequest(req);            // скаргу можна лишити й без входу
    const categories = Array.isArray(req.body?.categories)
      ? req.body.categories.filter((c) => CATEGORIES.includes(c))
      : [];
    const body = String(req.body?.body ?? "").trim().slice(0, 4000);
    const pointId = req.body?.point_id ?? null;
    // Ключ приймаємо лише свій: інакше чужим ключем можна було б підчепити
    // до скарги чуже фото.
    const photoKey = user && typeof req.body?.image_key === "string"
      && req.body.image_key.startsWith(`problems/`)
      && req.body.image_key.includes(`/${user.id}/`)
      ? req.body.image_key
      : null;

    if (!categories.length && !body && !photoKey) {
      return reply.code(400).send({ error: "empty_report" });
    }

    const row = await one(
      `insert into problem_reports (user_id, point_id, categories, body, image_r2_key)
       values ($1, $2, $3, $4, $5) returning id, created_at`,
      [user?.id ?? null, pointId, categories, body || null, photoKey]
    );
    return { id: row.id, created_at: row.created_at, photo: Boolean(photoKey) };
  });

  // Свої скарги — щоб екран міг показати «ми отримали» без окремого стану.
  app.get("/me/problems", async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) return { reports: [] };
    const rows = await many(
      `select id, categories, body, status, created_at, image_r2_key is not null as has_photo
         from problem_reports
        where user_id = $1 order by created_at desc limit 20`,
      [user.id]
    );
    return { reports: rows };
  });
}
