// Точка: меню для кіоска й телеметрія з малини (docs/urls.md, docs/admin_panel.md).
//
// Меню публічне: воно й так світиться на екрані в залі, а кіоск має брати
// його без жодного секрета. Те саме meню лежить у бакеті (scheduler кладе
// туди `points/<точка>/menu.json`) — тут воно рахується з тих самих
// `drinks`, тож точка може жити й доти, доки домен бакета не налаштований.
//
// Телеметрія — навпаки, під токеном точки: він довгий і лежить файлом на
// малині (scripts/point-token.mjs). Прийом ідемпотентний за idem_key:
// малина копить проби локально й досилає їх пачкою, коли інтернет
// повернувся, — повтор не має подвоювати рядки.
import { buildMenu } from "@extrovert/lib/menu.js";
import { pool, query } from "../db.js";
import { verifyToken } from "../auth.js";
import { fail } from "../errors.js";

const MAX_BATCH = 200;

// Токен точки: sub = point:<id>. Роль не перевіряємо — цей токен нічого
// іншого не відкриває (ws.js так само дивиться лише на канал).
function pointFromRequest(req) {
  const header = req.headers.authorization || "";
  const claims = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
  const sub = claims?.sub ?? "";
  return String(sub).startsWith("point:") ? String(sub).slice(6) : null;
}

export default async function routes(app) {
  // Меню точки. Кеш короткий: кіоск ходить сюди періодично й порівнює ETag.
  app.get("/points/:id/menu", async (req, reply) => {
    const point = await pool.query(
      "select id, machine_letter from points where id = $1 and status <> 'retired'", [req.params.id]);
    if (!point.rows[0]) fail(404, "no_such_point");
    const client = await pool.connect();
    try {
      const menu = await buildMenu(client, point.rows[0].machine_letter);
      reply.header("cache-control", "public, max-age=30");
      return menu;
    } finally {
      client.release();
    }
  });

  app.post("/points/:id/telemetry", async (req, reply) => {
    const authorized = pointFromRequest(req);
    if (!authorized || authorized !== req.params.id) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    // Одна проба або пачка — той самий роут: малині простіше слати список.
    const batch = Array.isArray(req.body?.samples) ? req.body.samples : [req.body];
    if (!batch.length || batch.length > MAX_BATCH) fail(400, "bad_batch");

    let written = 0;
    for (const sample of batch) {
      const source = String(sample?.source ?? "pi");
      if (!["pi", "jetinno", "camera"].includes(source)) fail(400, "bad_source");
      const measured = sample?.measured_at ? new Date(sample.measured_at) : new Date();
      if (Number.isNaN(+measured)) fail(400, "bad_measured_at");
      const idem = String(sample?.idem_key ?? `${source}:${measured.toISOString()}`).slice(0, 120);
      const metrics = sample?.metrics && typeof sample.metrics === "object" ? sample.metrics : {};

      const res = await query(
        `insert into device_telemetry (point_id, source, idem_key, measured_at, metrics)
         values ($1, $2, $3, $4, $5)
         on conflict (idem_key) do nothing`,
        [authorized, source, idem, measured.toISOString(), JSON.stringify(metrics)]
      );
      written += res.rowCount;
    }

    // Точка «жива», поки шле телеметрію — саме на це дивиться overseer і
    // дашборд здоровʼя.
    await query("update points set last_seen_at = now() where id = $1", [authorized]);
    return { accepted: batch.length, written };
  });
}
