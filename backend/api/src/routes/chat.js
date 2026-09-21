// Чат із кавенятком: історія, оплата повідомлень і виклик моделі.
//
// Порядок навмисний: спершу транзакцією списуємо монету й зберігаємо
// репліку гравця, і лише потім ідемо в мережу. Якщо модель не відповість,
// повідомлення гравця не загубиться, а монета списана рівно раз.
//
// Сумне чи зів'яле кавенятко не говорить (gamification_ui §«Коли редагувати
// не можна»): полив і є ліками.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { moodOf } from "./plants.js";
import { growthState } from "./planting.js";
import { search } from "../chat/knowledge.js";
import { buildMessages, factLines, prompts } from "../chat/prompt.js";
import { complete, hasKey, modelName, offlineAnswer } from "../chat/model.js";

const HISTORY_LIMIT = 40;          // скільки реплік показуємо
const CONTEXT_MESSAGES = 10;       // скільки з них віддаємо моделі

const view = (m) => ({
  id: m.id, role: m.role, body: m.body,
  coins_charged: m.coins_charged, created_at: m.created_at,
});

// Скільки коштує наступне повідомлення: перші кілька безкоштовні.
async function priceFor(userId, plantId) {
  const row = await one(
    "select count(*)::int as n from chat_messages where user_id = $1 and role = 'user'",
    [userId]
  );
  const used = row?.n ?? 0;
  const free = Math.max(0, economy.chat.free_messages - used);
  return { free_left: free, price: free > 0 ? 0 : economy.chat.price_coins, sent: used, plantId };
}

// Усе, що кавенятко знає про свого гравця. Збирається одним заходом на
// кожне повідомлення: стан акаунта змінюється між репліками.
async function gatherFacts(user, plant) {
  const [care, counts, drinks, wardrobe, orders] = await Promise.all([
    one("select water_liters, compost_kg, fertilizer_kg, insecticide_bottles, coins_yellow, coins_silver, beans, nickname from users where id = $1", [user.id]),
    one(
      `select
         (select count(*)::int from user_items where user_id = $1 and not locked) as items,
         (select count(*)::int from user_items where user_id = $1 and listing_id is not null) as listed,
         (select count(*)::int from receipt_items ri
            join bonus_grants bg on bg.receipt_id = ri.receipt_id
           where bg.redeemed_by = $1 and ri.is_bonus_drink = false) as drinks,
         (select count(*)::int from bonus_grants bg
            join receipts r on r.id = bg.receipt_id
           where bg.redeemed_by is null and r.point_id is not null) as unclaimed`,
      [user.id]
    ),
    many(
      `select ri.name, r.fiscal_date from receipt_items ri
         join receipts r on r.id = ri.receipt_id
         join bonus_grants bg on bg.receipt_id = r.id and bg.redeemed_by = $1
        order by r.fiscal_date desc limit 3`,
      [user.id]
    ),
    one(
      `select ws.tier, ws.gifted, ws.beans_awarded,
              (select count(*)::int from wardrobe_set_items where set_id = ws.id) as filled
         from wardrobe_sets ws where ws.id = $1`,
      [plant.worn_set_id]
    ),
    many(
      `select product as title, status
         from redemptions
        where user_id = $1 and status not in ('received', 'cancelled', 'returned')
        order by created_at desc limit 3`,
      [user.id]
    ),
  ]);

  return {
    nickname: care.nickname,
    lines: factLines({
      user: care,
      plant: { ...plant, mood: moodOf(plant) },
      growth: growthState(plant),
      care,
      counts,
      wardrobe,
      orders,
      lastDrinks: drinks,
    }),
  };
}

export default async function routes(app) {
  app.get("/me/plants/:id/chat", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const plant = await one("select * from plants where id = $1 and owner_id = $2", [req.params.id, user.id]);
    if (!plant) fail(404, "no_such_plant");

    const messages = await many(
      "select * from chat_messages where plant_id = $1 order by created_at desc limit $2",
      [plant.id, HISTORY_LIMIT]
    );
    const mood = moodOf(plant);
    return {
      plant: { id: plant.id, name: plant.name, growth_stage: plant.growth_stage, mood },
      messages: messages.reverse().map(view),
      ...(await priceFor(user.id, plant.id)),
      blocked: mood !== "healthy" ? "mood" : plant.listing_id ? "on_sale" : null,
      model: hasKey() ? modelName : "offline",
    };
  });

  app.post("/me/plants/:id/chat", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = String(req.body?.message ?? "").trim();
    if (!body) fail(400, "empty_message");
    if (body.length > 800) fail(400, "too_long");

    const plant = await one("select * from plants where id = $1 and owner_id = $2", [req.params.id, user.id]);
    if (!plant) fail(404, "no_such_plant");
    if (plant.listing_id) fail(409, "on_sale");
    if (moodOf(plant) !== "healthy") fail(409, "mood");

    const { price } = await priceFor(user.id, plant.id);

    // Списання й репліка гравця — атомарно. Якщо монет немає, нічого не
    // записуємо: інакше в історії висіли б питання без відповідей.
    const saved = await tx(async (client) => {
      if (price > 0) {
        const { rows } = await client.query(
          "update users set coins_yellow = coins_yellow - $2 where id = $1 and coins_yellow >= $2 returning coins_yellow",
          [user.id, price]
        );
        if (!rows.length) fail(409, "not_enough_coins", { need: price });
        await client.query(
          "insert into ledger_entries (user_id, delta_yellow, reason, meta) values ($1, $2, 'chat', $3)",
          [user.id, -price, { plant_id: plant.id }]
        );
      }
      const { rows } = await client.query(
        `insert into chat_messages (plant_id, user_id, role, body, coins_charged)
         values ($1, $2, 'user', $3, $4) returning *`,
        [plant.id, user.id, body, price]
      );
      return rows[0];
    });

    // Далі — мережа. Помилка тут не має «з'їдати» монету мовчки, тому
    // відповідь кавенятка пишемо окремим рядком і повертаємо обидва.
    const knowledge = await search(body, 4);
    const history = await many(
      "select role, body from chat_messages where plant_id = $1 and id < $2 order by id desc limit $3",
      [plant.id, saved.id, CONTEXT_MESSAGES]
    );
    const { lines: facts, nickname } = await gatherFacts(user, plant);
    const messages = buildMessages({
      plant, user: { nickname }, facts, knowledge, history: history.reverse(), message: body,
    });

    let answer = { text: "", tokens_in: null, tokens_out: null };
    try {
      answer = hasKey()
        ? await complete(messages)
        : { text: offlineAnswer(knowledge), tokens_in: null, tokens_out: null };
    } catch (e) {
      app.log.error({ err: e }, "чат: модель не відповіла");
      answer = { text: prompts.unavailable, tokens_in: null, tokens_out: null };
    }
    if (!answer.text) answer.text = prompts.fallback;

    const answered = await one(
      `insert into chat_messages (plant_id, user_id, role, body, tokens_in, tokens_out)
       values ($1, $2, 'plant', $3, $4, $5) returning *`,
      [plant.id, user.id, answer.text, answer.tokens_in, answer.tokens_out]
    );

    return {
      messages: [view(saved), view(answered)],
      charged: price,
      ...(await priceFor(user.id, plant.id)),
      used: knowledge.map(({ doc }) => doc.id),
    };
  });
}
