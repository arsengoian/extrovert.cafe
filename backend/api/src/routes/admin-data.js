// Адмінка: статистика, квізи, користувачі, покупки, відео
// (docs/admin_panel.md, групи «управління», «користувачі», «відео»).
//
// Проміжок дат приходить із екрана, типово — 30 діб. Ряди повертаємо
// добовими точками: графік за рік у такому вигляді — 365 чисел, і рахувати
// його на льоту дешевше, ніж тримати ще один кеш, який одного дня розійдеться
// з базою. Коли даних стане більше, сюди прийде матеріалізоване подання —
// і саме тому весь рахунок зібраний в одному місці.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { many, one } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { earnedCredits } from "./quiz.js";
import { redisClient } from "@extrovert/lib/redis.js";

const redis = redisClient();
// Дашборд за замовчуванням — це десяток групувань по всіх чеках за місяць.
// Рахувати їх на кожне відкриття екрана нема сенсу: дані добові, і в макеті
// так і написано — «кеш оновлено о 04:00». Тому типовий проміжок лежить у
// Redis до четвертої ранку, а свій проміжок із фільтра рахується наживо.
// Версія в ключі — щоб зміна складу відповіді не чекала 04:00: старий
// кеш просто перестає читатись (23.09.2026 так і сталось із розрізом
// ринку по виду товару).
const CACHE_KEY = "stats:v2:default";
const nextFourAm = () => {
  const now = new Date();
  const four = new Date(now);
  four.setHours(4, 0, 0, 0);
  if (four <= now) four.setDate(four.getDate() + 1);
  return Math.ceil((four - now) / 1000);
};

// Проміжок: from/to з екрана або останні 30 діб.
function range(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400_000);
  if (Number.isNaN(+from) || Number.isNaN(+to)) fail(400, "bad_range");
  return { from: from.toISOString(), to: to.toISOString() };
}

// Питання квізів описані в api/data/quiz.json — звідти беремо людські назви,
// тип і КАНОНІЧНИЙ порядок варіантів. Без нього дашборд показував ключі
// («how_found») і сортував «До 18 / 45+ / 25-34» за популярністю: для шкали
// віку чи міцності кави це нечитабельно (24.09.2026).
//
// Словники два, а не один спільний: `milk` є і в анкеті («звичайне /
// рослинне / без молока»), і в опитуванні про напій («водянисте /
// ідеальне / густе»). Спільна мапа тихо підмінила б варіанти одного
// питання варіантами іншого.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const quizDef = JSON.parse(readFileSync(path.join(HERE, "..", "..", "data", "quiz.json"), "utf8"));

// Короткі підписи карток — з макета: у ньому картка зветься «Вік», а не
// «Скільки тобі років?». Питання клієнта лишається питанням клієнта, а в
// адмінці над колонкою потрібне слово, а не речення.
const SHORT = {
  age: "Вік", how_found: "Як знайшли точку", favourite_drink: "Улюблена кава",
  frequency: "Частота", when: "Коли беруть каву", where: "Де пʼють",
  sugar: "Цукор", values: "Що найважливіше",
};

const PROFILE_Q = new Map();
for (const step of quizDef.profile?.steps ?? []) {
  for (const q of step.questions ?? []) {
    PROFILE_Q.set(q.id, {
      title: SHORT[q.id] ?? q.title ?? step.title,
      type: q.type,
      options: q.options ?? null,        // null — варіанти з бази (напої)
    });
  }
}
const DRINK_Q = new Map(
  (quizDef.drink?.scales ?? []).map((s) => [s.id, { title: s.title, type: "scale", options: s.options }])
);

// «Влучання в норму»: у шкалах напою середина — це і є те, чого людина
// хотіла. Пʼятибальної оцінки в анкеті немає й не було, тож замість
// вигаданої «середньої оцінки 4.4 / 5» рахуємо чесну частку відповідей
// «як має бути» — її видно з тих самих шкал і нічого не треба вигадувати.
const IDEAL = { coffee: "якраз", milk: "ідеальне", temperature: "гаряча", cleanliness: "чисто" };
const DIRTY = new Set(["так собі", "брудно"]);

const values = (answer) =>
  (Array.isArray(answer) ? answer : [answer]).filter((v) => v !== null && v !== undefined && v !== "");

// Відповіді квізів лежать у jsonb як {питання: відповідь | [відповіді]}.
// Рахуємо їх у застосунку, а не в SQL: питання додають у JSON-файлі, і
// запит, який знає їхні назви, застарів би наступного тижня.
//
// `answered` — скільки ЛЮДЕЙ відповіли, `total` — скільки галочок вони
// поставили. Для питань з кількома варіантами це різні числа, і відсоток
// у макеті рахується від людей: «смак кави 71%» плюс «ціна 54%» дають
// більше сотні, і так і має бути.
function tally(rows, defs) {
  // Починаємо з усіх питань анкети, а не з тих, на які відповіли: питання,
  // яке за місяць ніхто не зачепив, — це теж результат, і картка з нулями
  // краща за зниклу картку (чи за «gender» замість «Стать»).
  const questions = new Map(
    [...defs].filter(([, d]) => d.type !== "text").map(([id]) => [id, { counts: new Map(), answered: 0 }])
  );
  for (const row of rows) {
    for (const [question, answer] of Object.entries(row.answers ?? {})) {
      if (defs.get(question)?.type === "text") continue;   // текст читають словами, не стовпчиками
      const picked = values(answer);
      if (!picked.length) continue;
      if (!questions.has(question)) questions.set(question, { counts: new Map(), answered: 0 });
      const q = questions.get(question);
      q.answered++;
      for (const value of picked) q.counts.set(String(value), (q.counts.get(String(value)) ?? 0) + 1);
    }
  }
  return [...questions].map(([question, { counts, answered }]) => {
    const meta = defs.get(question);
    const listed = meta?.options ?? null;
    // Варіанти з анкети — у своєму порядку й разом із тими, яких ніхто не
    // обрав: «нуль голосів» — теж відповідь, і в макеті вона видима.
    const known = (listed ?? []).map((value) => ({ value, count: counts.get(value) ?? 0 }));
    const rest = [...counts].filter(([v]) => !listed?.includes(v))
      .map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    return {
      question,
      title: meta?.title ?? question,
      type: meta?.type ?? "single",
      answered,
      total: [...counts.values()].reduce((a, b) => a + b, 0),
      options: [...known, ...rest],
    };
  });
}

// Частка «як має бути» по чотирьох шкалах напою: одна відповідь — до
// чотирьох спостережень, бо кожна шкала важить однаково.
function idealShare(rows) {
  let hit = 0, seen = 0;
  for (const row of rows) {
    for (const [q, ideal] of Object.entries(IDEAL)) {
      const answer = row.answers?.[q];
      if (answer === undefined || answer === null || answer === "") continue;
      seen++;
      if (String(answer) === ideal) hit++;
    }
  }
  return seen ? hit / seen : null;
}

// Те саме по добах — ряд для графіка. Доба без відповідей у ряд не
// потрапляє: нуль там означав би «усе погано», а не «ніхто не відповів».
function idealByDay(rows) {
  const days = new Map();
  for (const row of rows) {
    const day = new Date(row.created_at).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(row);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, share: idealShare(list), n: list.length }))
    .filter((d) => d.share !== null);
}

export default async function routes(app) {
  // ── Дашборд статистики ──────────────────────────────────────────────
  app.get("/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const isDefault = !req.query.from && !req.query.to;

    if (isDefault) {
      const cached = await redis.get(CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached);
    }

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

    // Оборот ринку — по добах і по тому, що саме продали: кавенятко чи
    // одяг (кадр «P2P оборот»). Валюта поруч, бо жовті монети й боби в
    // одну суму не складаються.
    const market = await many(
      `select date_trunc('day', t.created_at) as day, l.kind, t.currency,
              count(*)::int as trades, sum(t.gross)::int as gross, sum(t.commission)::int as commission
         from market_trades t join market_listings l on l.id = t.listing_id
        where t.created_at between $1 and $2
        group by 1, 2, 3 order by 1`,
      [from, to]
    );

    const events = await many(
      `select date_trunc('day', started_at) as day, kind, count(*)::int as n
         from video_events where started_at between $1 and $2
        group by 1, 2 order by 1`,
      [from, to]
    );

    // Дохід за годиною дня й за днем тижня — два зрізи того самого чека
    // (кадри «Дохід за годиною дня» / «Дохід за днями тижня»). Рахуємо в
    // київському часі: «о восьмій ранку» має означати восьму в залі, а не
    // в UTC.
    const byHour = await many(
      `select extract(hour from r.fiscal_date at time zone 'Europe/Kyiv')::int as hour,
              sum(r.total_sum)::float as sum_uah, count(*)::int as receipts
         from receipts r where r.fiscal_date between $1 and $2
        group by 1 order by 1`,
      [from, to]
    );
    const byWeekday = await many(
      `select extract(isodow from r.fiscal_date at time zone 'Europe/Kyiv')::int as weekday,
              sum(r.total_sum)::float as sum_uah, count(*)::int as receipts
         from receipts r where r.fiscal_date between $1 and $2
        group by 1 order by 1`,
      [from, to]
    );

    // Взаємодія з бонусами: забрали чи лежить. Третього стану немає —
    // токен не згоряє (23.09.2026), тож «протухлих» більше не буває.
    const bonusSplit = await one(
      `select count(*) filter (where b.status = 'redeemed')::int as redeemed,
              count(*) filter (where b.status <> 'redeemed')::int as waiting
         from bonus_grants b join receipts r on r.id = b.receipt_id
        where r.fiscal_date between $1 and $2`,
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

    const payload = {
      from, to, totals, revenue, bonuses, coins, market, events,
      by_hour: byHour, by_weekday: byWeekday, bonus_split: bonusSplit,
      cached_at: new Date().toISOString(),
    };
    if (isDefault) await redis.set(CACHE_KEY, JSON.stringify(payload), "EX", nextFourAm()).catch(() => {});
    return payload;
  });

  // ── Дашборд опитувань ───────────────────────────────────────────────
  //
  // Усі відповіді про напої за період тягнемо один раз і ріжемо фільтром у
  // памʼяті: екран однаково показує і обраний напій, і «усі напої» поруч
  // (у KPI, у графіку за добу), тож два запити були б за тими самими
  // рядками. Їх тут тисячі, а не мільйони.
  app.get("/admin/quizzes", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const drink = String(req.query.drink ?? "");

    const profile = await many(
      "select answers, created_at from quiz_profile_responses where created_at between $1 and $2",
      [from, to]
    );
    const rows = await many(
      `select q.answers, q.free_text, q.created_at, i.slot, coalesce(d.name, i.name) as drink
         from quiz_drink_responses q
         join receipt_items i on i.id = q.receipt_item_id
         left join drinks d on d.slot = i.slot
        where q.created_at between $1 and $2
        order by q.created_at`,
      [from, to]
    );

    // Бонусні копії напою рахуються разом з основними — так і просив док:
    // номер позиції в них той самий.
    const byDrink = new Map();
    for (const r of rows) {
      const key = r.slot ?? "";
      if (!byDrink.has(key)) byDrink.set(key, { slot: key, name: r.drink ?? key, n: 0 });
      byDrink.get(key).n++;
    }
    const perDrink = [...byDrink.values()].sort((a, b) => b.n - a.n);
    const picked = drink ? rows.filter((r) => (r.slot ?? "") === drink) : rows;

    // Скарги на чистоту — з усіх відповідей, не з обраного напою: брудний
    // столик не залежить від того, що людина пила.
    const clean = rows.map((r) => r.answers?.cleanliness).filter(Boolean);
    const dirty = clean.filter((v) => DIRTY.has(String(v))).length;

    // Скільки кредитів на опитування гравці заробили за весь час і скільки
    // з них витратили. Мілстоуни рахує та сама функція, що й видає їх у
    // клієнті, — інакше два місця розійшлися б на першій же зміні економіки.
    const counts = await many(
      `select bg.redeemed_by as user_id, count(*)::int as drinks
         from receipt_items ri join bonus_grants bg on bg.receipt_id = ri.receipt_id
        where bg.redeemed_by is not null and ri.is_bonus_drink = false
        group by 1`
    );
    const earned = counts.reduce((a, u) => a + earnedCredits(u.drinks), 0);
    const spent = (await one("select count(*)::int as n from quiz_drink_responses"))?.n ?? 0;

    const players = (await one("select count(*)::int as n from users"))?.n ?? 0;
    const filled = (await one("select count(*)::int as n from quiz_profile_responses"))?.n ?? 0;

    const texts = picked.filter((r) => r.free_text?.trim());
    return {
      from, to, drink,
      profile: {
        total: profile.length,
        filled, players,
        questions: tally(profile, PROFILE_Q),
      },
      drinks: {
        total: picked.length,
        total_all: rows.length,
        per_drink: perDrink,
        questions: tally(picked, DRINK_Q),
        ideal: idealShare(picked),
        ideal_all: idealShare(rows),
        by_day: idealByDay(picked),
        by_day_all: idealByDay(rows),
        credits: { earned, spent },
        cleanliness: { dirty, answered: clean.length },
        texts: texts.slice(-40).reverse().map((r) => ({
          text: r.free_text.trim(), at: r.created_at, drink: r.drink ?? r.slot,
        })),
        texts_total: texts.length,
      },
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
          left join drinks d on d.slot = i.slot)
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
