// Сервіс ПРРО Checkbox: приймач вебхука + опитування чеків раз на хвилину.
//
// Обидва шляхи ведуть в один ingest() — і саме тому другий прихід того
// самого чека нічого не робить (docs/checkbox.md). Тут же перевірка
// підпису: без неї будь-хто накрутив би нам «продажі» й бонуси.
import crypto from "node:crypto";
import Fastify from "fastify";
import { pool } from "@extrovert/lib/db.js";
import { redisClient, closeRedis } from "@extrovert/lib/redis.js";
import { onShutdown } from "@extrovert/lib/shutdown.js";
import { makeLog } from "@extrovert/lib/log.js";
import { every, withLock } from "@extrovert/lib/jobs.js";
import { ingest } from "./receipts.js";
import { pollReceipts } from "./poll.js";

const log = makeLog("checkbox");
const redis = redisClient();
const app = Fastify({ logger: false });
const PORT = Number(process.env.PORT || 3003);

// Ключ підпису видає сам Checkbox у відповідь на реєстрацію вебхука
// (scripts/register-webhook.mjs), тож він лежить у базі, у webhook_keys, а
// не в .env: це похідне значення, а не налаштування. Кеш на хвилину, а при
// розбіжності підпису — одне перечитування: перереєстрація підхоплюється
// без рестарту.
const KEY_TTL_MS = 60_000;
let cachedKey = { key: "", at: 0 };
async function webhookKey({ fresh = false } = {}) {
  if (!fresh && Date.now() - cachedKey.at < KEY_TTL_MS) return cachedKey.key;
  const { rows } = await pool.query("select key from webhook_keys where provider = 'checkbox'");
  cachedKey = { key: rows[0]?.key ?? "", at: Date.now() };
  return cachedKey.key;
}

// Тіло потрібне байт-у-байт: підпис рахується від сирого тексту, а не від
// перезібраного JSON (пробіли й порядок ключів зруйнували б збіг).
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  req.rawBody = body;
  try { done(null, JSON.parse(body)); } catch (e) { done(e); }
});

const timingSafeEq = (a, b) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

// Підпис: HMAC-SHA256 тіла ключем із webhook_keys. Формат ключа й кодування
// підпису Checkbox у документації описує як base64 — але тестова каса
// 22.09.2026 слала щось інше, і кожен вебхук відлітав із «підпис не
// збігся». Тому пробуємо всі розумні варіанти: ключ як текст / як hex / як
// base64, підпис у base64 чи hex. Безпеки це не послаблює — усі варіанти
// однаково вимагають знати секрет, — а в лозі лишається той, що збігся, щоб
// звузити перевірку, коли стане ясно.
const KEY_FORMS = (key) => [
  ["text", Buffer.from(key, "utf8")],
  ["hex", /^[0-9a-f]+$/i.test(key) && key.length % 2 === 0 ? Buffer.from(key, "hex") : null],
  ["base64", /^[A-Za-z0-9+/=_-]+$/.test(key) ? Buffer.from(key, "base64") : null],
].filter(([, buf]) => buf && buf.length);

function matchSignature(key, raw, signature) {
  if (!key || !signature) return null;
  for (const [form, secret] of KEY_FORMS(key)) {
    for (const digest of ["base64", "hex"]) {
      const mine = crypto.createHmac("sha256", secret).update(raw, "utf8").digest(digest);
      if (timingSafeEq(signature, mine)) return `${form}/${digest}`;
    }
  }
  return null;
}
let knownForm = null;

app.get("/healthz", async () => ({ ok: true, service: "checkbox" }));

app.post("/webhook/checkbox", async (req, reply) => {
  const raw = req.rawBody ?? "";
  const signature = String(req.headers["x-signature"] ?? "");
  let key = await webhookKey();
  let form = matchSignature(key, raw, signature);
  // Не збіглося — можливо, вебхук перереєстрували: перечитуємо ключ один раз.
  if (!form) {
    key = await webhookKey({ fresh: true });
    form = matchSignature(key, raw, signature);
  }
  if (!form) {
    log.warn("підпис не збігся", { ip: req.ip, ключ: key ? "є" : "немає", підпис: signature ? signature.length : 0 });
    return reply.code(401).send({ error: "bad_signature" });
  }
  if (form !== knownForm) {
    knownForm = form;
    log.info("підпис вебхука сходиться", { формат: form });
  }

  const body = req.body ?? {};
  // Вебхук шле не лише чеки: зміни, службові внесення. Нас цікавлять чеки.
  const receipt = body.receipt ?? (body.id && body.goods ? body : null);
  if (!receipt) return { ok: true, ignored: body.type ?? "unknown" };

  try {
    const { duplicate } = await ingest(receipt, { source: "webhook", log });
    return { ok: true, duplicate };
  } catch (e) {
    log.error("чек із вебхука не записався", e);
    // 500 — навмисно: Checkbox повторить, а last_error_date у них покаже,
    // що ми падали (docs/checkbox.md, «Вебхук»).
    return reply.code(500).send({ error: "ingest_failed" });
  }
});

// Опитування — теж під блокуванням: у двох копіях сервісу воно ходило б у
// Checkbox удвічі частіше без жодної користі.
const stop = every(60_000, "checkbox-poll", async () => {
  const { skipped, result } = await withLock(redis, "checkbox-poll", 55_000, () => pollReceipts({ log }));
  if (!skipped && result?.done) log.info(result.done);
}, log);

await app.listen({ port: PORT, host: "0.0.0.0" });
log.info("checkbox піднявся", { port: PORT, poll: "раз на хвилину" });

// Спершу перестаємо брати нове — опитування й вебхук, — і лише потім
// закриваємо те, чим доробляється початий чек: інакше ingest() посеред
// транзакції лишиться без бази.
onShutdown({
  "опитування чеків": () => stop(),
  "вебхук": () => app.close(),
  "redis": () => closeRedis(),
  "postgres": () => pool.end(),
}, { log, timeoutMs: 25_000 });
