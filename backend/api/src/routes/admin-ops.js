// Адмінка: здоровʼя, точки, ціни, деплойменти, проблеми, замовлення
// (docs/admin_panel.md, групи «управління» й «операційка»).
//
// Усе тут — читання плюс кілька змін статусу. Проби здоровʼя збирає
// overseer у health_samples півгодинними відрами; api їх лише складає в
// ряди для графіка й не рахує нічого сам: дашборд, який опитує живі
// сервіси на кожне відкриття сторінки, лягає разом із ними.
import { many, one, tx } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";

// Як показувати ціль здоровʼя: група, назва, підпис. Порядок тут — порядок
// на екрані.
const TARGETS = [
  ["api", "services", "api", "REST і вебхуки"],
  ["ws", "services", "ws", "події гравцям"],
  ["checkbox", "services", "checkbox", "приймач ПРРО"],
  ["scheduler", "services", "scheduler", "фонові роботи"],
  ["overseer", "services", "overseer", "алерти"],
  ["caddy", "services", "caddy", "TLS і маршрути"],
  ["postgres", "services", "postgres", "база"],
  ["redis", "services", "redis", "черга й сесії"],
  ["front-client", "frontends", "клієнт extrovert.cafe", "застосунок гравця"],
  ["front-admin", "frontends", "адмінка", "ця сторінка"],
  ["front-qr", "frontends", "qr-наклейка", "302 на застосунок"],
  ["front-redirect", "frontends", "короткі посилання", "r.extrovert.cafe"],
  ["checkbox-webhook", "components", "вебхук ПРРО", "чеки доходять від Checkbox"],
  ["receipts", "components", "чеки", "продажі за добу"],
  ["outbox", "components", "публікатор подій", "черга outbox не стоїть"],
  ["menu-deploy", "components", "деплой меню", "ціни доїжджають на точки"],
  ["backup", "components", "бекап бази", "дамп у R2 за добу"],
];

const BUCKET_MS = 30 * 60_000;

// Ряд відер за тиждень одним рядком: «1» — усе гаразд, «0» — падало,
// «?» — проб не було. Відсутнє відро саме «не знаємо», а не «зелено»: так
// видно, що збирач не працював. Рядок замість масиву обʼєктів — це
// 337 символів проти десятків кілобайтів на кожну ціль, а екран малює
// смужку саме посимвольно.
function series(rows, now = Date.now()) {
  const byBucket = new Map(rows.map((r) => [new Date(r.bucket_start).getTime(), r]));
  const last = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const first = last - 7 * 24 * 3600_000;
  let line = "";
  const fails = [];
  for (let t = first; t <= last; t += BUCKET_MS) {
    const row = byBucket.get(t);
    line += row ? (row.ok ? "1" : "0") : "?";
    if (row && !row.ok) fails.push({ t, detail: row.detail });
  }
  // Деталі — лише для червоних відер: у тултіпі показувати нема чого, коли
  // все гаразд.
  return { from: first, step: BUCKET_MS, line, fails: fails.slice(-40) };
}

export default async function routes(app) {
  app.get("/admin/health", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const rows = await many(
      `select target, bucket_start, ok, detail, ms_total, ms_count from health_samples
        where bucket_start > now() - interval '7 days' order by bucket_start`
    );
    const byTarget = new Map();
    for (const r of rows) {
      if (!byTarget.has(r.target)) byTarget.set(r.target, []);
      byTarget.get(r.target).push(r);
    }

    const item = ([target, group, title, note]) => {
      const list = byTarget.get(target) ?? [];
      const last = list.at(-1);
      // Затримка — середнє за останнє відро, де вона взагалі є: у проб
      // без HTTP (heartbeat, черга outbox) її не буває.
      const timed = [...list].reverse().find((r) => r.ms_count > 0);
      return {
        target, group, title, note,
        ok: last ? last.ok : null,
        detail: last?.detail ?? null,
        at: last?.bucket_start ?? null,
        ms: timed ? Math.round(Number(timed.ms_total) / timed.ms_count) : null,
        history: series(list),
      };
    };

    const points = await many(
      `select id, name, address, short_address, last_seen_at,
              extract(epoch from (now() - last_seen_at)) / 60 as silent_minutes
         from points where status = 'live' order by name`
    );

    const items = TARGETS.map(item);
    const score = (group) => {
      const list = items.filter((i) => i.group === group);
      return { ok: list.filter((i) => i.ok).length, total: list.length, bad: list.filter((i) => i.ok === false).map((i) => `${i.title}: ${i.detail ?? "не відповідає"}`) };
    };

    return {
      updated_at: rows.at(-1)?.bucket_start ?? null,
      services: items.filter((i) => i.group === "services"),
      frontends: items.filter((i) => i.group === "frontends"),
      components: items.filter((i) => i.group === "components"),
      score: { services: score("services"), frontends: score("frontends"), components: score("components") },
      points: points.map((p) => {
        const list = byTarget.get(`point:${p.id}`) ?? [];
        const last = list.at(-1);
        return {
          ...p,
          ok: last ? last.ok : null,
          detail: last?.detail ?? null,
          history: series(list),
        };
      }),
    };
  });

  // Телеметрія точки: остання проба з кожного джерела плюс ряди для
  // графіків. Малина шле метрики пачками заднім числом, тому сортуємо за
  // measured_at, а не за часом отримання.
  app.get("/admin/points/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const point = await one(
      `select id, name, address, short_address, status, last_seen_at, checkbox_branch_id,
              key_hash is not null as has_key, key_revoked_at
         from points where id = $1`,
      [req.params.id]
    );
    if (!point) fail(404, "no_such_point");

    const latest = await many(
      `select distinct on (source) source, measured_at, metrics
         from device_telemetry where point_id = $1
        order by source, measured_at desc`,
      [point.id]
    );
    const history = await many(
      `select source, measured_at, metrics from device_telemetry
        where point_id = $1 and measured_at > now() - interval '7 days'
        order by measured_at`,
      [point.id]
    );
    const health = await many(
      `select bucket_start, ok, detail from health_samples
        where target = $1 and bucket_start > now() - interval '7 days' order by bucket_start`,
      [`point:${point.id}`]
    );
    const uptime = health.length ? health.filter((h) => h.ok).length / health.length : null;
    const receipts = await one(
      `select count(*)::int as day, max(fiscal_date) as last from receipts
        where point_id = $1 and fiscal_date > now() - interval '1 day'`,
      [point.id]
    );

    return {
      point,
      latest,
      history,
      health: series(health),
      uptime_7d: uptime,
      receipts,
    };
  });

  // ── Ціни ────────────────────────────────────────────────────────────
  // Поточний прайс — це просто `drinks`: саме з них збирається меню точки
  // (services.md §4). Поруч — стан останнього деплойменту по кожній точці.
  app.get("/admin/prices", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const drinks = await many(
      `select id, system_code, name, vol, price_uah, coins, bonus_coins, sprite, cup, color, foam, active, sort_order
         from drinks order by sort_order, name`
    );
    const points = await many("select id, name, short_address from points where status = 'live' order by name");
    const last = await one(
      `select id, status, created_at, finished_at, payload from menu_deployments order by id desc limit 1`
    );
    const targets = last
      ? await many(
          `select t.point_id, t.kind, t.status, t.error, t.done_at, t.acked_at, p.name
             from menu_deployment_targets t join points p on p.id = t.point_id
            where t.deployment_id = $1 order by p.name, t.kind`,
          [last.id]
        )
      : [];
    return { drinks, points, last_deployment: last ? { ...last, targets } : null };
  });

  // Зберегти правки прайсу. Саме меню на точки котить окремий деплоймент
  // (POST /admin/menu/deployments): спершу узгоджуємо ціни в базі, потім
  // свідомо вирішуємо, коли вони поїдуть на точку й у Checkbox.
  app.patch("/admin/prices", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const drinks = Array.isArray(req.body?.drinks) ? req.body.drinks : [];
    if (!drinks.length) fail(400, "nothing_to_save");
    const saved = await tx(async (client) => {
      const out = [];
      for (const d of drinks) {
        const price = Number(d.price_uah);
        if (!Number.isFinite(price) || price < 0 || price > 100000) fail(400, "bad_price");
        const { rows } = await client.query(
          `update drinks set price_uah = $2, coins = coalesce($3, coins), bonus_coins = coalesce($4, bonus_coins),
                  active = coalesce($5, active)
             where id = $1 returning id, system_code, price_uah, coins, bonus_coins, active`,
          [d.id, price, d.coins ?? null, d.bonus_coins ?? null, d.active ?? null]
        );
        if (rows[0]) out.push(rows[0]);
      }
      return out;
    });
    return { drinks: saved };
  });

  app.get("/admin/deployments", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await many(
      `select d.id, d.status, d.created_at, d.finished_at, d.scheduled_at,
              a.email as created_by,
              coalesce(jsonb_array_length(d.payload -> 'drinks'), 0) as drinks,
              (select json_agg(json_build_object('point_id', t.point_id, 'name', p.name, 'kind', t.kind, 'status', t.status, 'error', t.error, 'done_at', t.done_at) order by p.name, t.kind)
                 from menu_deployment_targets t join points p on p.id = t.point_id
                where t.deployment_id = d.id) as targets
         from menu_deployments d
         left join admin_users a on a.id = d.created_by
        order by d.id desc limit 50`
    );
    return { deployments: rows };
  });

  // ── Проблеми («щось не працює») ─────────────────────────────────────
  app.get("/admin/problems", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = String(req.query.status ?? "");
    const rows = await many(
      `select r.id, r.categories, r.body, r.image_r2_key, r.status, r.created_at,
              r.point_id, p.name as point_name, u.nickname, u.id as user_id
         from problem_reports r
         left join points p on p.id = r.point_id
         left join users u on u.id = r.user_id
        where ($1 = '' or r.status = $1)
        order by r.created_at desc limit 200`,
      [status]
    );
    const counts = await one(
      `select count(*) filter (where status = 'new')::int as new,
              count(*) filter (where status = 'read')::int as read,
              count(*) filter (where status = 'closed')::int as closed
         from problem_reports`
    );
    return { problems: rows, counts };
  });

  app.patch("/admin/problems/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = String(req.body?.status ?? "");
    if (!["new", "read", "closed"].includes(status)) fail(400, "bad_status");
    const row = await one("update problem_reports set status = $2 where id = $1 returning id, status", [req.params.id, status]);
    if (!row) fail(404, "no_such_problem");
    return row;
  });

  // ── Замовлення за зерна ─────────────────────────────────────────────
  app.get("/admin/orders", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = String(req.query.status ?? "");
    const rows = await many(
      `select r.id, r.product, r.options, r.status, r.created_at, r.np_ttn, r.np_status_code,
              r.recipient_name, r.np_address_snapshot, r.cost_uah_actual,
              u.id as user_id, u.nickname,
              abs(l.delta_beans) as beans
         from redemptions r
         join users u on u.id = r.user_id
         join ledger_entries l on l.id = r.ledger_entry_id
        where ($1 = '' or r.status = $1)
        order by r.created_at desc limit 200`,
      [status]
    );
    const counts = await one(
      `select count(*) filter (where status in ('new', 'printing', 'packing'))::int as open,
              count(*) filter (where status = 'shipped')::int as shipped,
              count(*) filter (where status = 'received')::int as received,
              count(*)::int as total
         from redemptions`
    );
    return { orders: rows, counts };
  });

  app.get("/admin/orders/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const order = await one(
      `select r.*, u.nickname, u.email
         from redemptions r join users u on u.id = r.user_id where r.id = $1`,
      [req.params.id]
    );
    if (!order) fail(404, "no_such_order");
    const events = await many(
      "select id, status, source, note, created_at from redemption_events where redemption_id = $1 order by id",
      [order.id]
    );
    return { order, events };
  });

  // Зміна статусу руками: друкуємо → пакуємо → відправлено. ТТН сюди ж,
  // коли її створять у кабінеті НП: створення накладної з адмінки ще немає
  // (docs/roadmap.md).
  app.post("/admin/orders/:id/status", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const status = String(req.body?.status ?? "");
    const ttn = req.body?.ttn ? String(req.body.ttn).trim() : null;
    const allowed = ["new", "printing", "packing", "shipped", "arrived", "received", "returned", "cancelled"];
    if (!allowed.includes(status)) fail(400, "bad_status");

    // Статус і подія — однією транзакцією: історія замовлення не має
    // розходитися з його станом.
    return tx(async (client) => {
      const { rows } = await client.query(
        `update redemptions set status = $2, np_ttn = coalesce($3, np_ttn) where id = $1 returning id, status, np_ttn`,
        [req.params.id, status, ttn]
      );
      if (!rows[0]) fail(404, "no_such_order");
      await client.query(
        `insert into redemption_events (redemption_id, status, source, note) values ($1, $2, 'admin', $3)`,
        [rows[0].id, status, req.body?.note ? String(req.body.note).slice(0, 300) : null]
      );
      return rows[0];
    });
  });
}
