// Підтримка через Telegram — наш бот (docs/services.md): кнопка «Підтримка»
// в застосунку відкриває t.me/<бот>, розмова живе в support_threads і
// support_messages, адмін відповідає з адмінки, а api пересилає відповідь
// назад через sendMessage.
//
// Хто пише, бот сам не знає: акаунт у застосунку — пошта чи Google, у боті —
// Telegram. Тому кнопка веде на t.me/<бот>?start=<одноразовий код>, і бот
// привʼязує тред до акаунта за цим кодом. Людина, що знайшла бота сама,
// лишається анонімною — теж нормально.
import crypto from "node:crypto";
import { redisClient } from "@extrovert/lib/redis.js";
import { many, one, query, tx } from "../db.js";
import { requireAdmin, userFromRequest } from "../auth.js";
import { fail } from "../errors.js";
import { enqueue } from "@extrovert/lib/outbox.js";
import { TelegramError, bot, download, sendMessage } from "../support/telegram.js";

const redis = redisClient();
const CODE_TTL_S = 60 * 60;
const codeKey = (code) => `support:start:${code}`;

const timingSafeEq = (a, b) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

// Що в повідомленні: текст (або підпис до фото) і вкладення file_id-ами.
function parse(message) {
  const files = [];
  if (message.photo?.length) {
    const p = message.photo[message.photo.length - 1];     // найбільший розмір
    files.push({ kind: "photo", file_id: p.file_id, width: p.width, height: p.height });
  }
  for (const kind of ["document", "video", "voice", "audio"]) {
    const f = message[kind];
    if (f) files.push({ kind, file_id: f.file_id, name: f.file_name ?? null, mime: f.mime_type ?? null });
  }
  const text = message.text ?? message.caption ?? message.sticker?.emoji ?? null;
  return { text, files };
}

// Привітання на /start — тексти з docs/support_bot_copy.md §6: з кодом
// (тред уже знає акаунт) і без нього (людина знайшла бота сама).
const GREETING_LINKED = `Привіт! Це підтримка extrovert.cafe 👋

Бачимо, з якого ви акаунта — не треба нічого пояснювати про себе.

Опишіть, що сталось: що замовляли, приблизно коли, і що пішло не так. Якщо є фото — просто прикріпіть, часто це найшвидший спосіб усе пояснити.

Відповідаємо живою людиною, тож трохи почекати — нормально.`;

const GREETING_ANONYMOUS = `Привіт! Це підтримка extrovert.cafe 👋

Цей чат не прив'язаний до вашого акаунта в застосунку — якщо звернення про конкретне замовлення чи кавенятко, краще зайти через кнопку «Підтримка» в самому застосунку: так ми одразу побачимо ваш акаунт.

Якщо це не про акаунт (питання про автомат, локацію, щось на точці) — просто пишіть тут. Вкажіть, будь ласка, де саме стоїть автомат і приблизно коли це було.`;

export default async function routes(app) {
  // Посилання на бота. Гостю — просто t.me/<бот>, гравцю — з одноразовим
  // кодом, щоб тред одразу знав, чий це акаунт.
  app.post("/support/link", async (req) => {
    const { username } = bot();
    if (!username) fail(503, "support_not_connected");
    const user = userFromRequest(req);
    if (!user) return { url: `https://t.me/${username}` };
    const code = crypto.randomBytes(12).toString("base64url");
    await redis.set(codeKey(code), user.id, "EX", CODE_TTL_S);
    return { url: `https://t.me/${username}?start=${code}` };
  });

  // Вебхук Telegram. secret_token перевіряємо завжди: без нього «повідомлення
  // від гравця» зміг би надіслати будь-хто. Відповідаємо 200 навіть на те,
  // що ігноруємо, — інакше Telegram повторюватиме оновлення.
  app.post("/webhook/telegram/support", async (req, reply) => {
    const { secret } = bot();
    const got = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    if (!secret || !timingSafeEq(got, secret)) return reply.code(401).send({ error: "bad_secret" });

    const update = req.body ?? {};
    const message = update.message ?? update.edited_message;
    if (!message?.chat || message.chat.type !== "private" || !update.update_id) return { ok: true, ignored: true };

    // Повтор того самого оновлення нічого не подвоює: update_id унікальний.
    const seen = await one("select 1 from support_messages where telegram_update_id = $1", [update.update_id]);
    if (seen) return { ok: true, duplicate: true };

    const chatId = String(message.chat.id);
    let { text, files } = parse(message);
    let userId = null;
    const start = Boolean(text?.startsWith("/start"));
    if (start) {
      const code = text.slice("/start".length).trim();
      if (code) userId = await redis.getdel(codeKey(code));
      text = "/start";                        // сам код у базу не пишемо
    }

    const thread = await tx(async (client) => {
      const { rows } = await client.query(
        `insert into support_threads (telegram_chat_id, user_id, telegram_username, status, last_user_at)
         values ($1, $2, $3, 'open', now())
         on conflict (telegram_chat_id) do update
            set telegram_username = coalesce(excluded.telegram_username, support_threads.telegram_username),
                user_id = coalesce(excluded.user_id, support_threads.user_id),
                status = 'open', last_user_at = now()
         returning id, user_id`,
        [chatId, userId, message.from?.username ?? null]
      );
      const { rowCount } = await client.query(
        `insert into support_messages (thread_id, direction, telegram_update_id, telegram_message_id, body, attachments)
         values ($1, 'in', $2, $3, $4, $5) on conflict (telegram_update_id) do nothing`,
        [rows[0].id, update.update_id, message.message_id, text, files.length ? JSON.stringify(files) : null]
      );
      // Повтор того самого update Telegram присилає сам — події на нього не
      // шлемо, інакше адмінка блимала б на порожньому місці.
      if (rowCount) {
        await enqueue(client, "admin", "support_message", {
          thread_id: Number(rows[0].id),
          preview: (text ?? "").slice(0, 120),
          files: files.length,
        });
      }
      return rows[0];
    });

    if (start) {
      const text = thread.user_id ? GREETING_LINKED : GREETING_ANONYMOUS;
      try {
        const sent = await sendMessage(chatId, text);
        await query(
          `insert into support_messages (thread_id, direction, telegram_message_id, body) values ($1, 'out', $2, $3)`,
          [thread.id, sent.message_id, text]
        );
      } catch (e) {
        app.log.warn({ err: e.message }, "привітання бота підтримки не відправилось");
      }
    }
    return { ok: true };
  });

  // ── адмінка ─────────────────────────────────────────────────────────
  // Треди: спершу ті, де останнє слово за гравцем, — на них і чекають.
  app.get("/admin/support/threads", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = ["open", "closed"].includes(req.query?.status) ? req.query.status : null;
    const rows = await many(
      `select t.id, t.status, t.telegram_username, t.last_user_at, t.last_admin_at, t.created_at,
              u.nickname,
              m.body as last_body, m.direction as last_direction, m.created_at as last_at,
              (m.attachments is not null) as last_has_files,
              t.last_user_at > coalesce(t.last_admin_at, 'epoch') as waiting
         from support_threads t
         left join users u on u.id = t.user_id
         left join lateral (
           select body, direction, created_at, attachments from support_messages
            where thread_id = t.id order by created_at desc, id desc limit 1
         ) m on true
        where ($1::text is null or t.status = $1)
        order by (t.status = 'open' and t.last_user_at > coalesce(t.last_admin_at, 'epoch')) desc,
                 coalesce(m.created_at, t.created_at) desc
        limit 100`,
      [status]
    );
    return { threads: rows, connected: Boolean(bot().token) };
  });

  app.get("/admin/support/threads/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const thread = await one(
      `select t.*, u.nickname from support_threads t left join users u on u.id = t.user_id where t.id = $1`,
      [req.params.id]
    );
    if (!thread) fail(404, "no_such_thread");
    const messages = await many(
      `select m.id, m.direction, m.body, m.attachments, m.created_at, a.email as admin_email
         from support_messages m left join admin_users a on a.id = m.admin_id
        where m.thread_id = $1 order by m.created_at, m.id limit 500`,
      [thread.id]
    );
    return { thread, messages };
  });

  app.post("/admin/support/threads/:id/reply", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const text = String(req.body?.text ?? "").trim();
    if (!text) fail(400, "empty_text");
    if (text.length > 4000) fail(400, "too_long");       // ліміт Telegram — 4096
    const thread = await one("select id, telegram_chat_id from support_threads where id = $1", [req.params.id]);
    if (!thread) fail(404, "no_such_thread");

    let sent;
    try {
      sent = await sendMessage(thread.telegram_chat_id, text);
    } catch (e) {
      if (e instanceof TelegramError) fail(e.status === 503 ? 503 : 502, e.status === 503 ? "support_not_connected" : "telegram_failed");
      throw e;
    }
    const row = await tx(async (client) => {
      const { rows } = await client.query(
        `insert into support_messages (thread_id, direction, telegram_message_id, body, admin_id)
         values ($1, 'out', $2, $3, $4) returning id, direction, body, attachments, created_at`,
        [thread.id, sent.message_id, text, admin.id]
      );
      await client.query(
        "update support_threads set last_admin_at = now(), status = 'open' where id = $1", [thread.id]);
      return rows[0];
    });
    return { ok: true, message: row };
  });

  app.post("/admin/support/threads/:id/status", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = req.body?.status;
    if (!["open", "closed"].includes(status)) fail(400, "bad_status");
    const row = await one("update support_threads set status = $2 where id = $1 returning id, status", [req.params.id, status]);
    if (!row) fail(404, "no_such_thread");
    return row;
  });

  // Вкладення тягнемо з Telegram лише на запит адміна й віддаємо як є.
  app.get("/admin/support/files/:fileId", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const { res, path } = await download(String(req.params.fileId));
      const type = res.headers.get("content-type") && res.headers.get("content-type") !== "application/octet-stream"
        ? res.headers.get("content-type")
        : /\.(jpe?g)$/i.test(path) ? "image/jpeg" : /\.png$/i.test(path) ? "image/png" : "application/octet-stream";
      reply.header("content-type", type);
      reply.header("cache-control", "private, max-age=3600");
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      if (e instanceof TelegramError) fail(e.status === 503 ? 503 : 502, "telegram_failed");
      throw e;
    }
  });
}
