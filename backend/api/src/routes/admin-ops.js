// Адмінка: здоровʼя, точки, ціни, деплойменти, проблеми, замовлення
// (docs/admin_panel.md, групи «управління» й «операційка»).
//
// Усе тут — читання плюс кілька змін статусу. Проби здоровʼя збирає
// overseer у health_samples півгодинними відрами; api їх лише складає в
// ряди для графіка й не рахує нічого сам: дашборд, який опитує живі
// сервіси на кожне відкриття сторінки, лягає разом із ними.
import { many, one, query, tx } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { presign } from "@extrovert/lib/r2.js";

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

    // Рядок POS має показувати не лише «озивається / мовчить», а самі
    // числа: інтернет, залізо, кіоск і автомат окремо (docs/admin_panel.md,
    // «телеметрія кожної POS»). Смужки overseer кажуть, коли ставало
    // погано; ці значення кажуть, як саме зараз — без переходу на сторінку
    // точки. Беремо останню пробу кожного джерела, історія лишається там.
    const telemetry = points.length
      ? await many(
          `select distinct on (point_id, source) point_id, source, measured_at, metrics
             from device_telemetry
            where point_id = any($1::text[])
              and measured_at > now() - interval '2 days'
            order by point_id, source, measured_at desc`,
          [points.map((p) => p.id)]
        )
      : [];
    const bySource = new Map();
    for (const t of telemetry) {
      if (!bySource.has(t.point_id)) bySource.set(t.point_id, {});
      bySource.get(t.point_id)[t.source] = { measured_at: t.measured_at, metrics: t.metrics ?? {} };
    }

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
        // Поруч зі зв'язком — монітор і відеопотік: те, чого «точка
        // озивається» не показує (overseer/health.js, 23.09.2026).
        const extra = (suffix) => {
          const rows = byTarget.get(`point:${p.id}:${suffix}`) ?? [];
          if (!rows.length) return null;
          const tail = rows.at(-1);
          return { ok: tail.ok, detail: tail.detail ?? null, history: series(rows) };
        };
        return {
          ...p,
          ok: last ? last.ok : null,
          detail: last?.detail ?? null,
          history: series(list),
          monitor: extra("monitor"),
          video: extra("video"),
          telemetry: bySource.get(p.id) ?? {},
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
  // Перекласти меню в бакет, не питаючи нікого: тією ж чергою, що й
  // деплоймент цін, але лише ціль r2. У машині й Checkbox від зміни напису
  // на екрані нічого не міняється, тож і цілей для них тут немає.
  async function queueMenuRefresh(client, adminId) {
    const { rows: points } = await client.query("select id from points where status <> 'retired' order by id");
    if (!points.length) return;
    const { rows } = await client.query(
      `insert into menu_deployments (payload, status, created_by)
       values ('{"reason":"promo"}'::jsonb, 'queued', $1) returning id`,
      [adminId]
    );
    for (const point of points) {
      await client.query(
        "insert into menu_deployment_targets (deployment_id, kind, point_id) values ($1, 'r2', $2)",
        [rows[0].id, point.id]
      );
    }
  }

  // ── акції ───────────────────────────────────────────────────────────
  //
  // Бібліотека готових панелей: у деплойменті акцію не пишуть щоразу
  // заново, а беруть звідси. Поля — рівно ті, що вміє намалювати кіоск
  // (raspberry/kiosk/src/menu.h): плашка, два рядки заголовка, акцентний
  // рядок, дрібний рядок і напій, зі спрайта якого береться картинка.
  const KINDS = ["promo", "notice", "news", "none"];
  const promoFrom = (body) => {
    const kind = String(body?.kind ?? "promo");
    if (!KINDS.includes(kind)) fail(400, "bad_kind");
    const head1 = String(body?.head1 ?? "").trim().slice(0, 64);
    if (!head1) fail(400, "head1_required");
    return [
      kind, head1,
      String(body?.head2 ?? "").trim().slice(0, 64),
      String(body?.sub ?? "").trim().slice(0, 64),
      String(body?.fine ?? "").trim().slice(0, 64),
      body?.drink_code ? String(body.drink_code).slice(0, 32) : null,
    ];
  };

  app.get("/admin/promos", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const promos = await many(
      `select p.*, d.name as drink_name, d.sprite as drink_sprite
         from promos p left join drinks d on d.slot = p.drink_code
        where p.archived_at is null
        -- Порядок СТАЛИЙ, за часом створення. Раніше поточна піднімалась
        -- нагору — і список пересортовувався прямо під курсором: людина
        -- тиснула «Показати» на новій акції, та ставала поточною й стрибала
        -- вгору, а на її місце приїжджала стара зі своєю кнопкою. Другий
        -- клік повертав усе назад, і виглядало це як «запит 200, а нічого
        -- не змінюється» (25.09.2026, власник). Поточну видно за бейджем,
        -- рядки при цьому не рухаються. id — тайбрейкер: дві акції, створені
        -- в одну мить, інакше йшли б у довільному порядку від запиту до запиту.
        order by p.created_at desc, p.id desc`
    );
    return { promos };
  });

  // Поточну акцію показує екран точки. Ставимо її й одразу перекладаємо
  // меню в бакет: деплоймент тут не потрібен (він про ціни, які їдуть ще
  // й у машину та Checkbox), але файл меню оновити треба — кіоск читає
  // саме його.
  app.post("/admin/promos/:id/current", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return tx(async (client) => {
      const { rows } = await client.query(
        "select id from promos where id = $1 and archived_at is null", [req.params.id]);
      if (!rows.length) fail(404, "no_such_promo");
      await client.query("update promos set is_current = false where is_current");
      await client.query("update promos set is_current = true, used_at = now() where id = $1", [rows[0].id]);
      await queueMenuRefresh(client, admin.id);
      return { ok: true, promo_id: Number(rows[0].id) };
    });
  });

  app.post("/admin/promos", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const values = promoFrom(req.body);
    return tx(async (client) => {
      const { rows: existing } = await client.query(
        "select 1 from promos where is_current and archived_at is null");
      const { rows } = await client.query(
        `insert into promos (kind, head1, head2, sub, fine, drink_code, is_current)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`, [...values, !existing.length]);
      if (!existing.length) await queueMenuRefresh(client, null);
      return { promo: rows[0] };
    });
  });

  app.patch("/admin/promos/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const values = promoFrom(req.body);
    return tx(async (client) => {
      const { rows } = await client.query(
        `update promos set kind = $2, head1 = $3, head2 = $4, sub = $5, fine = $6, drink_code = $7
          where id = $1 and archived_at is null returning *`, [req.params.id, ...values]);
      if (!rows.length) fail(404, "no_such_promo");
      // Правка ПОТОЧНОЇ акції — це зміна того, що просто зараз на екрані, тож
      // меню треба перекласти так само, як при виборі іншої акції. Без цього
      // запит відповідав 200, рядок у базі мінявся, а точка місяцями показувала
      // старий текст — і зрозуміти це можна було лише дійшовши до екрана
      // (25.09.2026, власник: додав тип «оголошення», на малині не змінилось).
      if (rows[0].is_current) await queueMenuRefresh(client, admin.id);
      return { promo: rows[0] };
    });
  });

  // Не видаляємо: акція могла поїхати на точку, і в історії деплойментів на
  // неї є посилання.
  app.delete("/admin/promos/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const promo = await one("select is_current from promos where id = $1", [req.params.id]);
    if (!promo) fail(404, "no_such_promo");
    // Поточна завжди одна: спершу зроби поточною іншу, потім архівуй цю.
    if (promo.is_current) fail(409, "promo_is_current");
    await query("update promos set archived_at = now() where id = $1", [req.params.id]);
    return { ok: true };
  });

  app.get("/admin/prices", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const drinks = await many(
      `select id, slot, name, vol, price_uah, coins, is_bonus, sprite, cup, color, foam, active, sort_order
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
          `update drinks set price_uah = $2, coins = coalesce($3, coins), is_bonus = coalesce($4, is_bonus),
                  active = coalesce($5, active)
             where id = $1 returning id, slot, price_uah, coins, is_bonus, active`,
          [d.id, price, d.coins ?? null, d.is_bonus ?? null, d.active ?? null]
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

  // Фото зі скарги лежить у приватному бакеті, тож адмінці потрібне
  // підписане посилання. ?download=1 віддає його з Content-Disposition —
  // інакше картинка просто відкривається вкладкою, а зберегти її окремим
  // рухом не вийде (прохання власника 23.09.2026).
  app.get("/admin/problems/:id/photo", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const row = await one("select image_r2_key from problem_reports where id = $1", [req.params.id]);
    if (!row?.image_r2_key) fail(404, "no_photo");
    const link = presign({
      method: "GET",
      purpose: "uploads",
      key: row.image_r2_key,
      expiresIn: 300,
      filename: req.query.download ? `скарга-${req.params.id}.${row.image_r2_key.split(".").pop()}` : null,
    });
    return { url: link.url, expires_in: link.expires_in };
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
