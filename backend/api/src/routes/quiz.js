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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const quiz = JSON.parse(readFileSync(path.join(HERE, "..", "..", "data", "quiz.json"), "utf8"));

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
    const done = await one("select created_at from quiz_profile_responses where user_id = $1", [user.id]);

    // Список напоїв у питанні «яку каву п'єш» береться з каталога, а не
    // дублюється в JSON: інакше нові напої довелося б вписувати двічі.
    const drinks = await many("select system_code, name from drinks where active order by sort_order");
    const steps = quiz.profile.steps.map((step) => ({
      ...step,
      questions: step.questions.map((q) =>
        q.source === "drinks" ? { ...q, options: drinks.map((d) => d.name) } : q
      ),
    }));

    return { done: Boolean(done), completed_at: done?.created_at ?? null, reward: economy.quiz.profile_coins, steps };
  });

  app.post("/quiz/profile", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const answers = req.body?.answers ?? {};
    const freeText = [answers.impression, answers.ideas].filter(Boolean).join("\n\n").trim() || null;
    if (!Object.keys(answers).length) return reply.code(400).send({ error: "empty_answers" });

    try {
      const saved = await tx(async (client) => {
        const { rows } = await client.query(
          `insert into quiz_profile_responses (user_id, answers, free_text, coins_awarded)
           values ($1, $2, $3, $4)
           on conflict (user_id) do nothing
           returning id`,
          [user.id, answers, freeText, economy.quiz.profile_coins]
        );
        if (!rows.length) return null;                   // анкета вже була
        await award(client, user.id, economy.quiz.profile_coins, "quiz", { quiz: "profile" });
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
              (q.id is not null) as answered
         from receipt_items ri
         join receipts r on r.id = ri.receipt_id
         join points p on p.id = r.point_id
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
    const answers = req.body?.answers ?? {};
    const freeText = String(req.body?.free_text ?? "").trim() || null;

    if (!Number.isInteger(itemId)) return reply.code(400).send({ error: "bad_item" });

    const owns = await one(
      `select 1 from receipt_items ri
         join bonus_grants bg on bg.receipt_id = ri.receipt_id
        where ri.id = $1 and bg.redeemed_by = $2`,
      [itemId, user.id]
    );
    if (!owns) return reply.code(404).send({ error: "no_such_item" });

    const drinks = await drinkCount(user.id);
    const used = await one("select count(*)::int as n from quiz_drink_responses where user_id = $1", [user.id]);
    if (earnedCredits(drinks) - used.n <= 0) return reply.code(409).send({ error: "no_credits" });

    try {
      const saved = await tx(async (client) => {
        const { rows } = await client.query(
          `insert into quiz_drink_responses (user_id, receipt_item_id, answers, free_text, coins_awarded)
           values ($1, $2, $3, $4, $5)
           on conflict (receipt_item_id) do nothing
           returning id`,
          [user.id, itemId, answers, freeText, economy.quiz.drink_coins]
        );
        if (!rows.length) return null;                   // про це замовлення вже відповідали
        await award(client, user.id, economy.quiz.drink_coins, "quiz", { quiz: "drink", receipt_item_id: itemId });
        return rows[0].id;
      });

      if (!saved) return reply.code(409).send({ error: "already_answered" });
      return { ok: true, awarded_silver: economy.quiz.drink_coins };
    } catch (e) {
      app.log.error(e);
      return reply.code(500).send({ error: "save_failed" });
    }
  });
}
