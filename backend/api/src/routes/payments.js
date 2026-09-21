// Купівля монет за гривні через mono pay.
//
// Нарахування живе в одному місці — settle() — і викликається двома
// шляхами: вебхуком від mono й опитуванням статусу з клієнта. Так само, як
// із чеками Checkbox: гарантувати «рівно один дзвінок» не може ніхто,
// гарантувати можна ідемпотентність. Тут її тримає `credited_at`, який
// ставиться тією ж транзакцією, що й нарахування.
//
// Без MONO_TOKEN (локально) працює тестова оплата: рахунок «оплачується»
// одразу, щоб екран можна було пройти цілком. У проді такого шляху немає.
import { one, query, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { notifyPlant } from "../notify.js";
import { createInvoice, hasToken, invoiceStatus, verifyWebhook } from "../payments/mono.js";

const DEV = process.env.DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";
const APP_ORIGIN = process.env.APP_ORIGIN || "https://extrovert.cafe";
const API_ORIGIN = process.env.API_ORIGIN || "https://api.extrovert.cafe";

const packBy = (code) => economy.coin_packs.find((p) => p.code === code) ?? null;

const view = (row) => ({
  invoice_id: row.invoice_id,
  status: row.status,
  coins: row.coins,
  // пачка — щоб попап «Монети зараховано» показав її картинку
  pack_code: row.pack_code,
  amount_uah: Number(row.amount_uah),
  credited: Boolean(row.credited_at),
});

// Нарахування: рівно раз на інвойс, у транзакції разом із журналом.
async function settle(invoiceId, status, raw = null) {
  return tx(async (client) => {
    const { rows } = await client.query(
      "select * from payments where invoice_id = $1 for update", [invoiceId]
    );
    const payment = rows[0];
    if (!payment) return { unknown: true };

    if (payment.credited_at) {
      // Повторний дзвінок — нормальна річ, а не помилка.
      return { payment, credited: true, duplicate: true };
    }

    await client.query(
      "update payments set status = $2, raw = coalesce($3, raw), updated_at = now() where id = $1",
      [payment.id, status, raw]
    );
    if (status !== "success") return { payment: { ...payment, status }, credited: false };

    await client.query("update users set coins_yellow = coins_yellow + $2 where id = $1",
      [payment.user_id, payment.coins]);
    const { rows: entry } = await client.query(
      `insert into ledger_entries (user_id, delta_yellow, reason, meta)
       values ($1, $2, 'purchase', $3) returning id`,
      [payment.user_id, payment.coins, { pack: payment.pack_code, invoice_id: invoiceId, uah: Number(payment.amount_uah) }]
    );
    await client.query(
      "update payments set credited_at = now(), ledger_entry_id = $2 where id = $1",
      [payment.id, entry[0].id]
    );
    await notifyPlant(payment.user_id, `Оплата пройшла: +${payment.coins} монет.`, { client });

    return { payment: { ...payment, status, credited_at: new Date() }, credited: true };
  });
}

export default async function routes(app) {
  // Створення рахунку. Рядок у payments з'являється до оплати: інакше,
  // повернувшись із банку, ми не знали б, за що прийшли гроші.
  app.post("/shop/coin-packs/:code/invoice", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const pack = packBy(String(req.params.code));
    if (!pack) fail(404, "no_such_pack");

    if (!hasToken()) {
      if (!DEV) fail(501, "payments_not_connected");
      // Локальний шлях: «оплата» проходить одразу, екран перевіряється
      // цілком, і жодного стосунку до прода це не має.
      const invoiceId = `test-${crypto.randomUUID()}`;
      await query(
        `insert into payments (user_id, provider, invoice_id, pack_code, coins, amount_uah, status)
         values ($1, 'test', $2, $3, $4, $5, 'processing')`,
        [user.id, invoiceId, pack.code, pack.coins, pack.price_uah]
      );
      await settle(invoiceId, "success", { test: true });
      return { test: true, invoice_id: invoiceId, status: "success", coins: pack.coins, pack_code: pack.code };
    }

    const reference = crypto.randomUUID();
    const { invoiceId, pageUrl } = await createInvoice({
      amountUah: pack.price_uah,
      reference,
      destination: `extrovert.cafe: ${pack.coins} монет`,
      // Клієнт памʼятає invoice_id у localStorage до переходу, тому в
      // адресі повернення досить прапорця: підставляти туди id платежу —
      // зайвий спосіб дати чужому посиланню чужий статус.
      redirectUrl: `${APP_ORIGIN}/?pay=1`,
      webHookUrl: `${API_ORIGIN}/api/v1/webhook/mono`,
      basket: [{
        name: `${pack.coins} монет`,
        qty: 1,
        sum: Math.round(Number(pack.price_uah) * 100),
        unit: "шт",
        code: pack.code,
      }],
    });

    await query(
      `insert into payments (user_id, provider, invoice_id, pack_code, coins, amount_uah, status, raw)
       values ($1, 'mono', $2, $3, $4, $5, 'created', $6)`,
      [user.id, invoiceId, pack.code, pack.coins, pack.price_uah, { reference, pageUrl }]
    );

    return { invoice_id: invoiceId, page_url: pageUrl, coins: pack.coins, amount_uah: pack.price_uah };
  });

  // Статус для клієнта. Якщо платіж ще не зарахований — питаємо mono самі:
  // вебхук може не дійти, і чекати на нього, дивлячись у спінер, гравець
  // не повинен.
  app.get("/me/payments/:invoiceId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const row = await one(
      "select * from payments where invoice_id = $1 and user_id = $2",
      [String(req.params.invoiceId), user.id]
    );
    if (!row) fail(404, "no_such_payment");
    if (row.credited_at || row.provider === "test") return view(row);

    try {
      const fresh = await invoiceStatus(row.invoice_id);
      const result = await settle(row.invoice_id, fresh.status, fresh);
      return view(result.payment ?? row);
    } catch (e) {
      app.log.warn({ err: e.message }, "статус mono недоступний");
      return view(row);
    }
  });

  app.get("/me/payments", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { rows } = await query(
      "select * from payments where user_id = $1 order by created_at desc limit 20", [user.id]
    );
    return { payments: rows.map(view) };
  });

  // Вебхук mono. Підпис перевіряємо завжди: без нього «оплачено» зміг би
  // надіслати будь-хто.
  app.post("/webhook/mono", async (req, reply) => {
    const raw = req.rawBody ?? JSON.stringify(req.body ?? {});
    const ok = await verifyWebhook(raw, String(req.headers["x-sign"] ?? ""));
    if (!ok) {
      app.log.warn("mono: підпис не збігся");
      return reply.code(401).send({ error: "bad_signature" });
    }

    const body = req.body ?? {};
    const status = body.status ? (body.status === "hold" ? "processing" : body.status) : null;
    if (!body.invoiceId || !status) return { ok: true, ignored: true };

    const result = await settle(String(body.invoiceId), status, body);
    if (result.unknown) app.log.warn({ invoiceId: body.invoiceId }, "mono: інвойс не наш");
    return { ok: true };
  });
}
