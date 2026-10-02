// Квізи: анкета профілю (одна на акаунт) і опитування про напій
// (за кредитами від лічильника напоїв, economy §2.4).
//
// Нагорода — срібні монети: вони не переказуються між гравцями, тож
// фарм анкетами нікуди не витікає (economy §2.1).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { economy } from "../economy.js";
import { credit, notifyPlant } from "../notify.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const quiz = JSON.parse(readFileSync(path.join(HERE, "..", "..", "data", "quiz.json"), "utf8"));

// Шкали, про які для цього напою не питаємо: молоко в еспресо, лунго,
// подвійному еспресо й американо (skip_for у quiz.json, власник 28.09.2026).
export const skippedScales = (sprite) =>
  (quiz.drink?.scales ?? []).filter((s) => sprite && (s.skip_for ?? []).includes(sprite)).map((s) => s.id);

// Кредити на квіз: мілстоуни 1, 4, 10 і далі кожен 10-й напій.
export function earnedCredits(drinks) {
  const { drink_credit_milestones: milestones, drink_credit_every: every } = economy.quiz;
  let earned = milestones.filter((m) => drinks >= m).length;
  if (drinks >= every) earned += Math.floor(drinks / every) - milestones.filter((m) => m % every === 0).length;
  return earned;
}

// Скільки напоїв гравець випив за все життя акаунта: позиції чеків, які
// він забрав собі бонусом (саме так чек звʼязується з гравцем).
async function drinkCount(userId) {
  const row = await one(
    `select count(*)::int as n
       from receipt_items ri
       join bonus_grants bg on bg.receipt_id = ri.receipt_id
      where bg.redeemed_by = $1 and ri.is_bonus_drink = false`,
    [userId]
  );
  return row?.n ?? 0;
}

// Відповіді анкети без порожніх: незаповнене питання не має потрапляти в
// базу як "" чи [] — статистика рахує кожне питання лише серед тих, хто
// справді відповів.
function profileAnswers(raw) {
  const out = {};
  for (const [k, raw_] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const v = typeof raw_ === "string" ? raw_.trim() : raw_;
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}
const freeTextOf = (a) => [a.impression, a.ideas].filter(Boolean).join("\n\n").trim() || null;

async function award(client, userId, silver, reason, meta) {
  await client.query("update users set coins_silver = coins_silver + $2 where id = $1", [userId, silver]);
  await client.query(
    `insert into ledger_entries (user_id, delta_silver, reason, meta) values ($1, $2, $3, $4)`,
    [userId, silver, reason, meta]
  );
}

export default async function routes(app) {
  // ── анкета профілю ────────────────────────────────────────────────────
  app.get("/quiz/profile", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    // Рядок є й у незавершеної анкети (completed_at порожній): «пройдено» —
    // лише коли її надіслали цілком.
    const row = await one("select answers, completed_at from quiz_profile_responses where user_id = $1", [user.id]);

    // Список напоїв у питанні «яку каву п'єш» береться з каталога, а не
    // дублюється в JSON: інакше нові напої довелося б вписувати двічі.
    // Лише те, що можна купити: без бонусних позицій (901–904 — той самий
    // напій, видача за бонус) і без схованих з меню (власник, 01.10.2026).
    const drinks = await many("select name, sprite from drinks where active and not is_bonus order by sort_order");
    // Для сітки напоїв (кадр «Розкажи про себе · крок 3») потрібна ще й
    // картинка — тож окрім назв віддаємо спрайти поруч.
    const steps = quiz.profile.steps.map((step) => ({
      ...step,
      questions: step.questions.map((q) =>
        q.source === "drinks"
          ? { ...q, options: drinks.map((d) => d.name), sprites: Object.fromEntries(drinks.map((d) => [d.name, d.sprite])) }
          : q
      ),
    }));

    return {
      done: Boolean(row?.completed_at),
      completed_at: row?.completed_at ?? null,
      // Відповіді незавершеної анкети: з ними її можна продовжити й з іншого
      // пристрою, а не лише з того, де лежить чернетка.
      progress: row && !row.completed_at ? row.answers : null,
      reward: economy.quiz.profile_coins,
      steps,
    };
  });

  // Пройдений крок анкети. Монет не дає — їх дає лише надіслана анкета
  // (POST нижче), — але відповіді вже йдуть у статистику адмінки: кинута на
  // третьому кроці анкета теж щось каже (власник, 01.10.2026). Завершену
  // анкету цей запит не чіпає.
  app.put("/quiz/profile/progress", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const answers = profileAnswers(req.body?.answers);
    if (!Object.keys(answers).length) return { ok: true };
    await one(
      `insert into quiz_profile_responses (user_id, answers, free_text, coins_awarded)
       values ($1, $2, $3, 0)
       on conflict (user_id) do update set answers = excluded.answers, free_text = excluded.free_text
         where quiz_profile_responses.completed_at is null
       returning id`,
      [user.id, answers, freeTextOf(answers)]
    );
    return { ok: true };
  });

  app.post("/quiz/profile", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const answers = profileAnswers(req.body?.answers);
    const freeText = freeTextOf(answers);
    if (!Object.keys(answers).length) return reply.code(400).send({ error: "empty_answers" });

    try {
      const saved = await tx(async (client) => {
        // Незавершений рядок (кроки, пройдені раніше) стає завершеним;
        // завершений не чіпаємо — це «анкета вже була».
        const { rows } = await client.query(
          `insert into quiz_profile_responses (user_id, answers, free_text, coins_awarded, completed_at)
           values ($1, $2, $3, $4, now())
           on conflict (user_id) do update
             set answers = excluded.answers, free_text = excluded.free_text,
                 coins_awarded = excluded.coins_awarded, completed_at = now()
             where quiz_profile_responses.completed_at is null
           returning id`,
          [user.id, answers, freeText, economy.quiz.profile_coins]
        );
        if (!rows.length) return null;                   // анкета вже була
        await award(client, user.id, economy.quiz.profile_coins, "quiz", { quiz: "profile" });
        // Нарахування срібла — рядком у чат кавенятка, як і за пост
        // (gamification_ui.md, «Сповіщення»).
        await notifyPlant(user.id, `Дякуємо за анкету: ${credit(economy.quiz.profile_coins, "silver")}.`, { client });
        return rows[0].id;
      });

      if (!saved) return reply.code(409).send({ error: "already_done" });
      return { ok: true, awarded_silver: economy.quiz.profile_coins };
    } catch (e) {
      app.log.error(e);
      return reply.code(500).send({ error: "save_failed" });
    }
  });

  // ── квіз про напій ────────────────────────────────────────────────────
  app.get("/quiz/drink", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const drinks = await drinkCount(user.id);
    const used = await one("select count(*)::int as n from quiz_drink_responses where user_id = $1", [user.id]);
    const credits = Math.max(0, earnedCredits(drinks) - used.n);

    // Пройти можна про будь-яке замовлення з історії, не лише про останнє.
    const items = await many(
      `select ri.id, ri.name, ri.price_uah, r.fiscal_date, p.name as point_name,
              (q.id is not null) as answered,
              -- картинка напою для картки зверху (кадр «Опитування про напій»)
              d.sprite
         from receipt_items ri
         join receipts r on r.id = ri.receipt_id
         join points p on p.id = r.point_id
         left join drinks d on d.slot = ri.slot
         join bonus_grants bg on bg.receipt_id = r.id and bg.redeemed_by = $1
         left join quiz_drink_responses q on q.receipt_item_id = ri.id
        where ri.is_bonus_drink = false
        order by r.fiscal_date desc
        limit 30`,
      [user.id]
    );

    return { credits, drinks, reward: economy.quiz.drink_coins, scales: quiz.drink.scales,
             free_text: quiz.drink.free_text, items };
  });

  app.post("/quiz/drink", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const itemId = Number(req.body?.receipt_item_id);
    const raw = req.body?.answers;
    const answers = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
    const freeText = String(req.body?.free_text ?? "").trim() || null;

    if (!Number.isInteger(itemId)) return reply.code(400).send({ error: "bad_item" });

    const owns = await one(
      `select 1 from receipt_items ri
         join bonus_grants bg on bg.receipt_id = ri.receipt_id
        where ri.id = $1 and bg.redeemed_by = $2`,
      [itemId, user.id]
    );
    if (!owns) return reply.code(404).send({ error: "no_such_item" });

    // Про молоко в каві без молока не питали — і не зберігаємо, навіть якщо
    // старий клієнт таки надіслав.
    const drink = await one(
      "select d.sprite from receipt_items ri left join drinks d on d.slot = ri.slot where ri.id = $1", [itemId]);
    for (const id of skippedScales(drink?.sprite)) delete answers[id];

    // Шкали обов'язкові, необов'язковий лише текст (власник, 01.10.2026):
    // відгук без оцінок нічого не каже, а монети за нього платяться. Лишаємо
    // тільки відомі шкали й відомі варіанти — решту клієнт не мав би слати.
    const skipped = new Set(skippedScales(drink?.sprite));
    const scales = (quiz.drink?.scales ?? []).filter((s) => !skipped.has(s.id));
    for (const id of Object.keys(answers)) if (!scales.some((s) => s.id === id)) delete answers[id];
    const missing = scales.filter((s) => !s.options.includes(answers[s.id])).map((s) => s.id);
    if (missing.length) return reply.code(400).send({ error: "incomplete", missing });

    // Кредити вирішують лише те, чи буде нагорода. Сам відгук приймаємо
    // завжди: якщо напій не сподобався, людина має де це сказати, а нам
    // такий відгук цінніший за зекономлене срібло (рішення власника
    // 23.09.2026).
    const drinks = await drinkCount(user.id);
    const used = await one("select count(*)::int as n from quiz_drink_responses where user_id = $1", [user.id]);
    const reward = earnedCredits(drinks) - used.n > 0 ? economy.quiz.drink_coins : 0;

    try {
      const saved = await tx(async (client) => {
        const { rows } = await client.query(
          `insert into quiz_drink_responses (user_id, receipt_item_id, answers, free_text, coins_awarded)
           values ($1, $2, $3, $4, $5)
           on conflict (receipt_item_id) do nothing
           returning id`,
          [user.id, itemId, answers, freeText, reward]
        );
        if (!rows.length) return null;                   // про це замовлення вже відповідали
        if (reward) {
          await award(client, user.id, reward, "quiz", { quiz: "drink", receipt_item_id: itemId });
          await notifyPlant(user.id, `Дякуємо за відгук про напій: ${credit(reward, "silver")}.`, { client });
        }
        return rows[0].id;
      });

      if (!saved) return reply.code(409).send({ error: "already_answered" });
      return { ok: true, awarded_silver: reward };
    } catch (e) {
      app.log.error(e);
      return reply.code(500).send({ error: "save_failed" });
    }
  });
}
