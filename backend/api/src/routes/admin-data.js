// Адмінка: статистика, квізи, користувачі, покупки, відео
// (docs/admin_panel.md, групи «управління», «користувачі», «відео»).
//
// Акаунти поза статистикою (users.stats_excluded — свої й тестові, власник
// 04.10.2026) у підрахунки не потрапляють: in_stats(user_id) для всього,
// що робить акаунт, receipt_in_stats(id) для чеків, бонус із яких забрав
// такий акаунт. У списках (гравці, покупки, стрічка квізів) вони лишаються
// з позначкою — щоб їх було видно й можна було зняти прапорець.
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
import { pageInfo, pageOf } from "../paging.js";
import { earnedCredits, skippedScales } from "./quiz.js";
import { redisClient } from "@extrovert/lib/redis.js";

const redis = redisClient();
// Дашборд за замовчуванням — це десяток групувань по всіх чеках за місяць.
// Рахувати їх на кожне відкриття екрана нема сенсу: дані добові, і в макеті
// так і написано — «кеш оновлено о 04:00». Тому типовий проміжок лежить у
// Redis до четвертої ранку, а свій проміжок із фільтра рахується наживо.
// Версія в ключі — щоб зміна складу відповіді не чекала 04:00: старий
// кеш просто перестає читатись (23.09.2026 так і сталось із розрізом
// ринку по виду товару).
const CACHE_KEY = "stats:v4:default";
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
  sugar: "Цукор", values: "Що найважливіше", bean_sort: "Зерно", extras: "Що беруть до напою",
};

const PROFILE_Q = new Map();
for (const step of quizDef.profile?.steps ?? []) {
  for (const q of step.questions ?? []) {
    PROFILE_Q.set(q.id, {
      title: SHORT[q.id] ?? q.title ?? step.title,
      // Сегмент із multi (молоко) — для адмінки те саме, що «кілька варіантів».
      type: q.multi ? "multi" : q.type,
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
  // ── Аналітика застосунку гравця ─────────────────────────────────────
  // Готові зрізи за 1/7/30 діб і денні відра для трендів — рахує scheduler
  // (jobs/analytics.js) раз на десять хвилин; тут лише читання й групування
  // у { метрика: { розріз: значення } }. Тренд — щонайменше за 14 днів:
  // на «добі» одна точка графіка нічого не показує.
  //
  // part=tech — лише запити до api (api_*, route_*): їх показує «Здоровʼя»,
  // і решту зрізів йому тягнути нема чого (18.10.2026).
  app.get("/admin/analytics", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const tech = req.query.part === "tech";
    const rows = await many(
      `select metric, dim, value, computed_at from analytics_window
        where days = $1 and (not $2::boolean or metric like 'api\\_%' or metric like 'route\\_%')`,
      [days, tech]
    );
    const window = {};
    for (const r of rows) (window[r.metric] ??= {})[r.dim] = Number(r.value);
    if (tech) return { days, computed_at: rows[0]?.computed_at ?? null, window, daily: [] };
    const daily = await many(
      `select day::text as day, metric, dim, value from analytics_daily
        where day > (now() at time zone 'Europe/Kyiv')::date - $1::int order by day`,
      [Math.max(days, 14)]
    );
    return {
      days,
      computed_at: rows[0]?.computed_at ?? null,
      window,
      daily: daily.map((r) => ({ ...r, value: Number(r.value) })),
    };
  });

  // ── «Гравці» → економіка гри: бонуси, монети, зерна, ринок ─────────
  // Виручка й години продажів — routes/admin-sales.js («Фінанси»), події
  // камери — «Продажі», нові й активні гравці — «Застосунок» (18.10.2026).
  app.get("/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const isDefault = !req.query.from && !req.query.to;

    if (isDefault) {
      const cached = await redis.get(CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached);
    }

    // Бонуси за чек — за датою ЧЕКА, і в KPI, і на графіку: досі KPI рахував
    // за датою, коли бонус забрали, а кругова діаграма поруч — за датою чека,
    // і екран показував два різні числа про те саме (18.10.2026).
    const bonuses = await many(
      `select date_trunc('day', r.fiscal_date at time zone 'Europe/Kyiv') as day,
              count(*)::int as granted,
              count(*) filter (where b.status = 'redeemed')::int as redeemed,
              coalesce(sum(b.coins_yellow) filter (where b.status = 'redeemed'), 0)::int as coins
         from bonus_grants b join receipts r on r.id = b.receipt_id
        where r.fiscal_date between $1 and $2 and in_stats(b.redeemed_by)
        group by 1 order by 1`,
      [from, to]
    );

    // Монети й боби: окремо зароблене й витрачене, бо «чистий приріст»
    // ховає і те, і те.
    const coins = await many(
      `select date_trunc('day', created_at at time zone 'Europe/Kyiv') as day,
              sum(delta_yellow) filter (where delta_yellow > 0)::int as yellow_in,
              -sum(delta_yellow) filter (where delta_yellow < 0)::int as yellow_out,
              sum(delta_silver) filter (where delta_silver > 0)::int as silver_in,
              -sum(delta_silver) filter (where delta_silver < 0)::int as silver_out,
              sum(delta_beans) filter (where delta_beans > 0)::int as beans_in,
              -sum(delta_beans) filter (where delta_beans < 0)::int as beans_out
         from ledger_entries where created_at between $1 and $2 and in_stats(user_id)
        group by 1 order by 1`,
      [from, to]
    );

    // Оборот ринку — по добах і по тому, що саме продали: кавенятко чи
    // одяг (кадр «P2P оборот»). Валюта поруч, бо жовті монети й боби в
    // одну суму не складаються.
    const market = await many(
      `select date_trunc('day', t.created_at at time zone 'Europe/Kyiv') as day, l.kind, t.currency,
              count(*)::int as trades, sum(t.gross)::int as gross, sum(t.commission)::int as commission
         from market_trades t join market_listings l on l.id = t.listing_id
        where t.created_at between $1 and $2 and in_stats(t.buyer_id) and in_stats(t.seller_id)
        group by 1, 2, 3 order by 1`,
      [from, to]
    );

    // Взаємодія з бонусами: забрали чи лежить. Третього стану немає —
    // токен не згоряє (23.09.2026), тож «протухлих» більше не буває.
    const bonusSplit = await one(
      `select count(*) filter (where b.status = 'redeemed')::int as redeemed,
              count(*) filter (where b.status <> 'redeemed')::int as waiting
         from bonus_grants b join receipts r on r.id = b.receipt_id
        where r.fiscal_date between $1 and $2 and in_stats(b.redeemed_by)`,
      [from, to]
    );

    // Ринок — усі валюти разом (у KPI це «скільки монет перейшло з рук у
    // руки»), комісія й кількість угод — підписом під ним.
    const totals = await one(
      `select coalesce(sum(gross), 0)::int as market_gross, coalesce(sum(commission), 0)::int as market_commission,
              count(*)::int as market_trades
         from market_trades where created_at between $1 and $2 and in_stats(buyer_id) and in_stats(seller_id)`,
      [from, to]
    );

    const payload = {
      from, to, totals, bonuses, coins, market, bonus_split: bonusSplit,
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
      // Разом із незавершеними анкетами: їхні відповіді теж рахуються, кожне
      // питання — лише серед тих, хто на нього відповів (tally), 01.10.2026.
      "select answers, created_at, completed_at from quiz_profile_responses where created_at between $1 and $2 and in_stats(user_id)",
      [from, to]
    );
    const rows = await many(
      `select q.answers, q.free_text, q.created_at, i.slot, coalesce(d.name, i.name) as drink, d.sprite
         from quiz_drink_responses q
         join receipt_items i on i.id = q.receipt_item_id
         left join drinks d on d.slot = i.slot
        where q.created_at between $1 and $2 and in_stats(q.user_id)
        order by q.created_at`,
      [from, to]
    );

    // Відповіді про молоко в каві без молока (еспресо, лунго, подвійний,
    // американо) — не рахуються: тепер про нього там не питаємо, а старі
    // такі відповіді лише псували б шкалу (власник, 28.09.2026).
    for (const r of rows) {
      const skip = skippedScales(r.sprite);
      if (skip.length && r.answers) r.answers = Object.fromEntries(Object.entries(r.answers).filter(([k]) => !skip.includes(k)));
    }

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
        where bg.redeemed_by is not null and ri.is_bonus_drink = false and in_stats(bg.redeemed_by)
        group by 1`
    );
    const earned = counts.reduce((a, u) => a + earnedCredits(u.drinks), 0);
    const spent = (await one("select count(*)::int as n from quiz_drink_responses where in_stats(user_id)"))?.n ?? 0;

    const players = (await one("select count(*)::int as n from users where not stats_excluded"))?.n ?? 0;
    const filled = (await one("select count(*)::int as n from quiz_profile_responses where completed_at is not null and in_stats(user_id)"))?.n ?? 0;

    const texts = picked.filter((r) => r.free_text?.trim());
    return {
      from, to, drink,
      profile: {
        total: profile.length,
        partial: profile.filter((r) => !r.completed_at).length,
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
    const pg = pageOf(req.query);
    const rows = await many(
      // Обидві гілки union мають віддавати ті самі колонки: коли в гілку
      // напою додали sprite (шкали, про які не питали), без null тут запит
      // падав цілком, і стрічка показувала «internal» (28.09.2026).
      `(select 'profile' as kind, q.id, q.created_at, q.answers, q.free_text, q.coins_awarded,
               u.id as user_id, u.nickname, u.stats_excluded, null as drink, null as sprite, q.completed_at is null as partial
          from quiz_profile_responses q join users u on u.id = q.user_id)
       union all
       (select 'drink' as kind, q.id, q.created_at, q.answers, q.free_text, q.coins_awarded,
               u.id as user_id, u.nickname, u.stats_excluded, coalesce(d.name, i.name) as drink, d.sprite, false as partial
          from quiz_drink_responses q
          join users u on u.id = q.user_id
          join receipt_items i on i.id = q.receipt_item_id
          left join drinks d on d.slot = i.slot)
       order by created_at desc limit $1 offset $2`,
      [pg.per, pg.offset]
    );
    for (const r of rows) {
      const skip = skippedScales(r.sprite);
      if (skip.length && r.answers) r.answers = Object.fromEntries(Object.entries(r.answers).filter(([k]) => !skip.includes(k)));
    }
    // Ті самі join, що й у гілках union: відповідь без гравця чи позиції чека
    // до списку не потрапляє — не має потрапляти й до лічильника.
    const total = await one(
      `select (select count(*) from quiz_profile_responses q join users u on u.id = q.user_id)
            + (select count(*) from quiz_drink_responses q
                 join users u on u.id = q.user_id
                 join receipt_items i on i.id = q.receipt_item_id) as n`
    );
    return { responses: rows, page: pageInfo(pg, total.n) };
  });

  // ── Користувачі ─────────────────────────────────────────────────────
  app.get("/admin/users", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = String(req.query.q ?? "").trim();
    const pg = pageOf(req.query);
    const where = "($1 = '' or u.nickname ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%')";
    const users = await many(
      `select u.id, u.nickname, u.email, u.coins_yellow, u.coins_silver, u.beans,
              u.last_seen_at, u.created_at, u.deleted_at, u.stats_excluded,
              (select count(*)::int from plants p where p.owner_id = u.id) as plants,
              (select count(*)::int from user_items i where i.user_id = u.id) as items,
              (select max(growth_stage) from plants p where p.owner_id = u.id) as top_stage
         from users u
        where ${where}
        order by u.last_seen_at desc nulls last, u.created_at desc, u.id
        limit $2 offset $3`,
      [q, pg.per, pg.offset]
    );
    const found = await one(`select count(*)::int as n from users u where ${where}`, [q]);
    const counts = await one(
      `select count(*) filter (where deleted_at is null)::int as total,
              count(*) filter (where last_seen_at > now() - interval '7 days')::int as week,
              count(*) filter (where created_at > now() - interval '7 days')::int as fresh
         from users where not stats_excluded`
    );
    return { users, counts, page: pageInfo(pg, found.n) };
  });

  app.get("/admin/users/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const user = await one(
      `select id, nickname, email, coins_yellow, coins_silver, beans, water_liters, compost_kg,
              fertilizer_kg, insecticide_bottles, consent_at, terms_version, metadata,
              last_seen_at, created_at, deleted_at, nickname_changed_at, stats_excluded
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

  // Прапорець «поза статистикою» (власник, 04.10.2026): свої й тестові
  // акаунти. Дані акаунта не чіпає — лише підрахунки, і в обидва боки.
  // Типовий дашборд лежить у кеші до 04:00, а денні відра аналітики
  // перераховуються лише за сьогодні й учора, тож скидаємо обидва: кеш
  // порахується на наступному відкритті, відра — за ≤10 хв (scheduler
  // перераховує дні, для яких відер немає).
  app.post("/admin/users/:id/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (typeof req.body?.excluded !== "boolean") fail(400, "bad_flag");
    const row = await one(
      "update users set stats_excluded = $2 where id = $1 returning id, stats_excluded",
      [req.params.id, req.body.excluded]
    );
    if (!row) fail(404, "no_such_user");
    await redis.del(CACHE_KEY).catch(() => {});
    await many("delete from analytics_daily");
    return { ok: true, stats_excluded: row.stats_excluded };
  });

  // Покупки (чеки з бонусом і відео) — routes/admin-sales.js.

  // ── Відео ───────────────────────────────────────────────────────────
  // Сегменти пише recorder на малині, події — worker (backend/worker). Ключі
  // доказів у `evidence` віддаємо як є: підписує їх окремий маршрут у
  // routes/video.js, бо бакет приватний.
  // Один запит — один список (?list=segments|events) зі своєю сторінкою:
  // досі обидва їхали разом, обрізані до 100 і 200, а KPI «Сегментів» був
  // довжиною того обрізаного списку — рівно 100 за будь-якого архіву
  // (власник, 16.10.2026). KPI тепер з усієї таблиці.
  app.get("/admin/video", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const point = String(req.query.point ?? "");
    const pg = pageOf(req.query);
    const stats = await one(
      `select (select count(*)::int from video_segments) as segments,
              (select count(*)::int from video_segments where status = 'pending') as pending,
              (select count(*)::int from video_segments where status = 'failed') as failed,
              (select count(*)::int from video_segments where status = 'done' and analysis_version < 2) as old,
              (select coalesce(sum(bytes), 0)::bigint from video_segments where status <> 'expired') as bytes,
              (select count(*)::int from video_events where superseded_at is null) as events`
    );

    if (req.query.list !== "events") {
      // Фільтр стану — щоб знайти, скажімо, лише ті, що впали, а не гортати
      // тисячі оброблених.
      const status = String(req.query.status ?? "");
      const where = "($1 = '' or s.point_id = $1) and ($2 = '' or s.status = $2)";
      const rows = await many(
        `select s.id, s.point_id, s.camera_id, s.started_at, s.duration_ms, s.bytes, s.status, s.attempts, s.error,
                s.source, s.analysis_version
           from video_segments s where ${where}
          order by s.started_at desc, s.id desc limit $3 offset $4`,
        [point, status, pg.per, pg.offset]
      );
      const total = await one(`select count(*)::int as n from video_segments s where ${where}`, [point, status]);
      return { list: "segments", rows, page: pageInfo(pg, total.n), stats };
    }

    // Події за період (типово 30 діб), без замінених переаналізом; поруч —
    // прохід людини (напрямок, чи це персонал) і його смужка вирізок.
    // Фільтри: тип події й «без персоналу» (власник, 16.10.2026). Лічильники
    // типів — з тими самими фільтрами, крім самого типу: так на кнопці видно,
    // скільки буде, якщо її натиснути.
    const { from, to } = range(req.query);
    const kind = String(req.query.kind ?? "");
    const guests = req.query.staff === "hide";
    const base = `from video_events e
         left join video_passages pa on pa.id = e.passage_id
         left join video_people pe on pe.id = pa.person_id
        where e.superseded_at is null and e.started_at between $1 and $2 and ($3 = '' or e.point_id = $3)
          and (not $4::boolean or coalesce(pe.staff, false) = false)`;
    const p = [from, to, point, guests];
    const rows = await many(
      `select e.id, e.point_id, e.kind, e.started_at, e.ended_at, e.likely_receipt_id, e.evidence, e.meta,
              e.passage_id, pa.direction, pa.heading, pa.person_id, pa.receipt_match,
              jsonb_array_length(coalesce(pa.crops, '[]')) as crops, pe.staff
         ${base} and ($5 = '' or e.kind = $5)
        order by e.started_at desc, e.id desc limit $6 offset $7`,
      [...p, kind, pg.per, pg.offset]
    );
    const kinds = await many(`select e.kind, count(*)::int as n ${base} group by e.kind`, p);
    const total = kinds.filter((k) => !kind || k.kind === kind).reduce((s, k) => s + k.n, 0);
    return { list: "events", rows, page: pageInfo(pg, total), stats, kinds, from, to };
  });
}
