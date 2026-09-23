// Адмінка: статистика, квізи, користувачі, покупки, відео
// (docs/admin_panel.md, групи «управління», «користувачі», «відео»).
//
// Проміжок дат приходить із екрана, типово — 30 діб. Ряди повертаємо
// добовими точками: графік за рік у такому вигляді — 365 чисел, і рахувати
// його на льоту дешевше, ніж тримати ще один кеш, який одного дня розійдеться
// з базою. Коли даних стане більше, сюди прийде матеріалізоване подання —
// і саме тому весь рахунок зібраний в одному місці.
import { many, one } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";

// Проміжок: from/to з екрана або останні 30 діб.
function range(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400_000);
  if (Number.isNaN(+from) || Number.isNaN(+to)) fail(400, "bad_range");
  return { from: from.toISOString(), to: to.toISOString() };
}

// Відповіді квізів лежать у jsonb як {питання: відповідь | [відповіді]}.
// Рахуємо їх у застосунку, а не в SQL: питання додають у JSON-файлі, і
// запит, який знає їхні назви, застарів би наступного тижня.
function tally(rows) {
  const questions = new Map();
  for (const row of rows) {
    for (const [question, answer] of Object.entries(row.answers ?? {})) {
      if (!questions.has(question)) questions.set(question, new Map());
      const counts = questions.get(question);
      for (const value of Array.isArray(answer) ? answer : [answer]) {
        if (value === null || value === undefined || value === "") continue;
        const key = String(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...questions].map(([question, counts]) => ({
    question,
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    options: [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
  }));
}

export default async function routes(app) {
  // ── Дашборд статистики ──────────────────────────────────────────────
  app.get("/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);

    const revenue = await many(
      `select date_trunc('day', r.fiscal_date) as day, r.point_id, p.name as point_name,
              sum(r.total_sum)::float as sum_uah, count(*)::int as receipts
         from receipts r left join points p on p.id = r.point_id
        where r.fiscal_date between $1 and $2
        group by 1, 2, 3 order by 1`,
      [from, to]
    );

    const bonuses = await many(
      `select date_trunc('day', r.fiscal_date) as day,
              count(*)::int as granted,
              count(*) filter (where b.status = 'redeemed')::int as redeemed,
              coalesce(sum(b.coins_yellow) filter (where b.status = 'redeemed'), 0)::int as coins
         from bonus_grants b join receipts r on r.id = b.receipt_id
        where r.fiscal_date between $1 and $2
        group by 1 order by 1`,
      [from, to]
    );

    // Монети й боби: окремо зароблене й витрачене, бо «чистий приріст»
    // ховає і те, і те.
    const coins = await many(
      `select date_trunc('day', created_at) as day,
              sum(delta_yellow) filter (where delta_yellow > 0)::int as yellow_in,
              -sum(delta_yellow) filter (where delta_yellow < 0)::int as yellow_out,
              sum(delta_silver) filter (where delta_silver > 0)::int as silver_in,
              -sum(delta_silver) filter (where delta_silver < 0)::int as silver_out,
              sum(delta_beans) filter (where delta_beans > 0)::int as beans_in,
              -sum(delta_beans) filter (where delta_beans < 0)::int as beans_out
         from ledger_entries where created_at between $1 and $2
        group by 1 order by 1`,
      [from, to]
    );

    const market = await many(
      `select date_trunc('day', created_at) as day, currency,
              count(*)::int as trades, sum(gross)::int as gross, sum(commission)::int as commission
         from market_trades where created_at between $1 and $2
        group by 1, 2 order by 1`,
      [from, to]
    );

    const events = await many(
      `select date_trunc('day', started_at) as day, kind, count(*)::int as n
         from video_events where started_at between $1 and $2
        group by 1, 2 order by 1`,
      [from, to]
    );

    const totals = await one(
      `select (select coalesce(sum(total_sum), 0)::float from receipts where fiscal_date between $1 and $2) as revenue,
              (select count(*)::int from receipts where fiscal_date between $1 and $2) as receipts,
              (select count(*)::int from users where created_at between $1 and $2 and deleted_at is null) as new_users,
              (select count(*)::int from users where last_seen_at between $1 and $2) as active_users,
              (select count(*)::int from bonus_grants where redeemed_at between $1 and $2) as redeemed,
              (select coalesce(sum(gross), 0)::int from market_trades where created_at between $1 and $2) as market_gross`,
      [from, to]
    );

    return { from, to, totals, revenue, bonuses, coins, market, events };
  });

  // ── Дашборд опитувань ───────────────────────────────────────────────
  app.get("/admin/quizzes", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const drink = String(req.query.drink ?? "");

    const profile = await many(
      "select answers from quiz_profile_responses where created_at between $1 and $2",
      [from, to]
    );
    const drinks = await many(
      `select q.answers, i.system_code, d.name
         from quiz_drink_responses q
         join receipt_items i on i.id = q.receipt_item_id
         left join drinks d on d.system_code = i.system_code
        where q.created_at between $1 and $2 and ($3 = '' or i.system_code = $3)`,
      [from, to, drink]
    );
    // Бонусні копії напою рахуються разом з основними — так і просив док:
    // system_code у них той самий.
    const perDrink = await many(
      `select i.system_code, coalesce(d.name, i.name) as name, count(*)::int as n
         from quiz_drink_responses q join receipt_items i on i.id = q.receipt_item_id
         left join drinks d on d.system_code = i.system_code
        where q.created_at between $1 and $2
        group by 1, 2 order by n desc`,
      [from, to]
    );

    return {
      from, to, drink,
      profile: { total: profile.length, questions: tally(profile) },
      drinks: { total: drinks.length, questions: tally(drinks), per_drink: perDrink },
    };
  });

  // Стрічка відповідей: те саме, але поштучно й зі словами.
  app.get("/admin/quiz-responses", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await many(
      `(select 'profile' as kind, q.id, q.created_at, q.answers, q.free_text, q.coins_awarded,
               u.id as user_id, u.nickname, null as drink
          from quiz_profile_responses q join users u on u.id = q.user_id)
       union all
       (select 'drink' as kind, q.id, q.created_at, q.answers, q.free_text, q.coins_awarded,
               u.id as user_id, u.nickname, coalesce(d.name, i.name) as drink
          from quiz_drink_responses q
          join users u on u.id = q.user_id
          join receipt_items i on i.id = q.receipt_item_id
          left join drinks d on d.system_code = i.system_code)
       order by created_at desc limit 200`
    );
    return { responses: rows };
  });

  // ── Користувачі ─────────────────────────────────────────────────────
  app.get("/admin/users", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = String(req.query.q ?? "").trim();
    const users = await many(
      `select u.id, u.nickname, u.email, u.coins_yellow, u.coins_silver, u.beans,
              u.last_seen_at, u.created_at, u.deleted_at,
              (select count(*)::int from plants p where p.owner_id = u.id) as plants,
              (select count(*)::int from user_items i where i.user_id = u.id) as items,
              (select max(growth_stage) from plants p where p.owner_id = u.id) as top_stage
         from users u
        where ($1 = '' or u.nickname ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%')
        order by u.last_seen_at desc nulls last, u.created_at desc
        limit 200`,
      [q]
    );
    const counts = await one(
      `select count(*) filter (where deleted_at is null)::int as total,
              count(*) filter (where last_seen_at > now() - interval '7 days')::int as week,
              count(*) filter (where created_at > now() - interval '7 days')::int as fresh
         from users`
    );
    return { users, counts };
  });

  app.get("/admin/users/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const user = await one(
      `select id, nickname, email, coins_yellow, coins_silver, beans, water_liters, compost_kg,
              fertilizer_kg, insecticide_bottles, consent_at, terms_version, metadata,
              last_seen_at, created_at, deleted_at, nickname_changed_at
         from users where id = $1`,
      [req.params.id]
    );
    if (!user) fail(404, "no_such_user");

    const [identities, plants, ledger, items, chat, crates, receipts, orders] = await Promise.all([
      many("select provider, subject, created_at from user_identities where user_id = $1", [user.id]),
      many(
        `select id, name, growth_stage, cycle_phase, last_watered_at, last_stage_transition_at,
                lifetime_beans_gifted, created_at
           from plants where owner_id = $1 order by created_at`,
        [user.id]
      ),
      many(
        `select id, delta_yellow, delta_silver, delta_beans, reason, ref_type, ref_id, created_at
           from ledger_entries where user_id = $1 order by id desc limit 100`,
        [user.id]
      ),
      many(
        `select i.id, i.acquired_from, i.locked, i.acquired_at, d.code, d.name, d.tier, d.slot
           from user_items i join item_defs d on d.id = i.item_def_id
          where i.user_id = $1 order by i.acquired_at desc limit 100`,
        [user.id]
      ),
      many(
        `select id, role, body, coins_charged, created_at from chat_messages
          where user_id = $1 order by id desc limit 50`,
        [user.id]
      ),
      many(
        `select o.id, o.source, o.rolled_tier, o.was_duplicate, o.result_coins, o.opened_at, d.name as item
           from crate_openings o left join item_defs d on d.id = o.result_item_id
          where o.user_id = $1 order by o.id desc limit 50`,
        [user.id]
      ),
      many(
        `select r.id, r.fiscal_date, r.total_sum, r.point_id, b.coins_yellow, b.redeemed_at
           from bonus_grants b join receipts r on r.id = b.receipt_id
          where b.redeemed_by = $1 order by r.fiscal_date desc limit 50`,
        [user.id]
      ),
      many(
        `select id, product, status, created_at, np_ttn from redemptions
          where user_id = $1 order by id desc limit 20`,
        [user.id]
      ),
    ]);

    return { user, identities, plants, ledger, items, chat, crates, receipts, orders };
  });

  // ── Покупки з Checkbox ──────────────────────────────────────────────
  app.get("/admin/receipts", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const point = String(req.query.point ?? "");
    const rows = await many(
      `select r.id, r.point_id, p.name as point_name, r.fiscal_date, r.total_sum, r.source, r.tax_url,
              r.checkbox_receipt_id,
              (select json_agg(json_build_object('name', i.name, 'qty', i.qty, 'sum', i.sum_uah, 'bonus', i.is_bonus_drink) order by i.id)
                 from receipt_items i where i.receipt_id = r.id) as items,
              b.status as bonus_status, b.coins_yellow as bonus_coins, b.show_until, b.redeemed_at,
              u.id as redeemed_by, u.nickname as redeemed_nickname
         from receipts r
         left join points p on p.id = r.point_id
         left join bonus_grants b on b.receipt_id = r.id
         left join users u on u.id = b.redeemed_by
        where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3)
        order by r.fiscal_date desc limit 200`,
      [from, to, point]
    );
    const totals = await one(
      `select count(*)::int as receipts, coalesce(sum(total_sum), 0)::float as sum_uah,
              count(*) filter (where exists (select 1 from bonus_grants b where b.receipt_id = r.id and b.status = 'redeemed'))::int as redeemed
         from receipts r where r.fiscal_date between $1 and $2 and ($3 = '' or r.point_id = $3)`,
      [from, to, point]
    );
    return { from, to, receipts: rows, totals };
  });

  // ── Відео ───────────────────────────────────────────────────────────
  // Камер поки немає (docs/video.md — план), тож екрани чесно показують
  // порожньо. Таблиці вже є, і щойно зʼявиться worker, ці ж запити почнуть
  // повертати дані.
  app.get("/admin/video", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const point = String(req.query.point ?? "");
    const segments = await many(
      `select s.id, s.point_id, s.camera_id, s.started_at, s.duration_ms, s.bytes, s.status, s.attempts, s.error
         from video_segments s where ($1 = '' or s.point_id = $1)
        order by s.started_at desc limit 100`,
      [point]
    );
    const events = await many(
      `select e.id, e.point_id, e.kind, e.started_at, e.ended_at, e.likely_receipt_id, e.evidence
         from video_events e where ($1 = '' or e.point_id = $1)
        order by e.started_at desc limit 100`,
      [point]
    );
    const stats = await one(
      `select (select count(*)::int from video_segments where status = 'pending') as pending,
              (select count(*)::int from video_segments where status = 'failed') as failed,
              (select coalesce(sum(bytes), 0)::bigint from video_segments) as bytes,
              (select count(*)::int from video_events) as events`
    );
    const perDay = await many(
      `select date_trunc('day', started_at) as day, kind, count(*)::int as n
         from video_events where started_at > now() - interval '30 days'
        group by 1, 2 order by 1`
    );
    return { segments, events, stats, per_day: perDay };
  });
}
