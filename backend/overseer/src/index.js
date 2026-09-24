// Overseer: єдиний, хто говорить з людьми голосом Telegram. Дивиться за
// тим, що не видно з застосунку — чи живі точки, чи йдуть продажі, чи не
// зламався вебхук Checkbox — і пише в робочий чат.
//
// Принцип: **алерт лише на зміну стану**. Бот, який щохвилини пише «усе
// добре», перестають читати, і разом з «усе добре» пропускають «точка
// мовчить третю годину». Тому стан кожної перевірки зберігається в Redis, і
// повідомлення йде тільки коли стан змінився. Щоденний звіт — виняток: він
// не алерт, а зведення.
import { pool } from "@extrovert/lib/db.js";
import { presign } from "@extrovert/lib/r2.js";
import { redisClient, closeRedis } from "@extrovert/lib/redis.js";
import { onShutdown } from "@extrovert/lib/shutdown.js";
import { makeLog } from "@extrovert/lib/log.js";
import { initErrors } from "@extrovert/lib/errors.js";
import { every, heartbeat, withLock } from "@extrovert/lib/jobs.js";
import { checkPoints, checkWebhook, dailyReport } from "./checks.js";
import { sampleHealth } from "./health.js";
import { send } from "./telegram.js";

const log = makeLog("overseer");
initErrors("overseer", { log });
const redis = redisClient();

const MINUTE = 60_000;
const INTERVAL = Number(process.env.OVERSEER_INTERVAL_MS || 5 * MINUTE);

// Повідомляємо лише про зміну стану — і пам'ятаємо попередній у Redis, щоб
// перезапуск сервісу не перетворювався на нову хвилю алертів.
async function onChange(key, state, text) {
  const previous = await redis.get(`overseer:${key}`);
  if (previous === state) return false;
  await redis.set(`overseer:${key}`, state);
  // Перший запуск після порожнього Redis: стан запам'ятовуємо, але мовчимо,
  // якщо він добрий — інакше кожен деплой вітався б купою «усе гаразд».
  if (previous === null && state === "ok") return false;
  await send(text, { log });
  return true;
}

async function tick() {
  const points = await checkPoints(pool);
  for (const p of points) {
    await onChange(`point:${p.id}`, p.state,
      p.state === "ok"
        ? `✅ ${p.name}: знову на звʼязку`
        : `🔌 ${p.name}: мовчить ${p.silentFor}`);
  }

  const webhook = await checkWebhook();
  // «unknown» — це не поломка, а «не змогли спитати»: мовчимо.
  if (webhook && webhook.state !== "unknown") {
    await onChange("checkbox-webhook", webhook.state,
      webhook.state === "ok"
        ? "✅ Вебхук Checkbox: помилок немає"
        : `⚠️ Вебхук Checkbox: ${webhook.message}`);
  }
}

// Звіт раз на добу о 9:00 за Києвом: не алерт, а зведення за вчора.
async function reportTick() {
  const now = new Date();
  const kyivHour = Number(new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "numeric", hour12: false }).format(now));
  if (kyivHour !== 9) return;
  const key = `overseer:report:${now.toISOString().slice(0, 10)}`;
  // SET NX — щоб звіт пішов один раз, навіть якщо сервіс перезапустили
  // о девʼятій.
  const first = await redis.set(key, "1", "EX", 26 * 3600, "NX");
  if (!first) return;
  await send(await dailyReport(pool), { log });
}

// Скарги з застосунку — не за розкладом, а одразу: людина стоїть біля
// автомата, і «на наступному обході через пʼять хвилин» тут не годиться
// (прохання власника 23.09.2026). api кладе подію в outbox у тій самій
// транзакції, scheduler публікує її в канал `admin` — ми лише слухаємо той
// самий канал, що й адмінка.
//
// Окреме зʼєднання, бо в режимі підписки ioredis не приймає звичайних
// команд, а onChange() і heartbeat ходять у Redis постійно.
const CATEGORY = {
  coffee_machine: "кавомашина", monitor: "монітор", site: "сайт",
  supplies: "витратники", idea: "ідея",
};

const sub = redisClient();
await sub.subscribe("admin");
sub.on("message", async (_channel, raw) => {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (event.event !== "problem_reported") return;
  const what = (event.categories ?? []).map((c) => CATEGORY[c] ?? c).join(", ");
  // Фото — прямим посиланням, а не файлом: бакет приватний, і тягнути
  // мегабайти через бота, щоб їх потім тримав телеграм, немає за що.
  // Доба — щоб посилання лишалось робочим, коли алерт читають зранку
  // (прохання власника 24.09.2026).
  let photo = null;
  if (event.image_key) {
    try {
      photo = presign({ method: "GET", purpose: "uploads", key: event.image_key, expiresIn: 24 * 3600 }).url;
    } catch (e) {
      log.warn({ err: e.message }, "не підписали посилання на фото скарги");
    }
  }
  const lines = [
    `🛠 Нова скарга${event.nickname ? ` від ${event.nickname}` : " (без входу)"}`,
    what ? `Про що: ${what}` : null,
    event.preview ? `«${event.preview}»` : null,
    photo ?? (event.photo ? "З фото" : null),
  ].filter(Boolean);
  await send(lines.join("\n"), { log });
});

const stopBeat = heartbeat(redis, "overseer");

const stops = [
  // Проби здоровʼя для адмінки. Частіше за алерти: відро півгодинне, і
  // кілька проб у ньому — це різниця між «моргнуло» й «лежало».
  every(2 * MINUTE, "health-samples", async () => {
    const { skipped } = await withLock(redis, "health-samples", 110_000, () => sampleHealth({ pool, redis, log }));
    if (skipped) log.info("проби здоровʼя вже йдуть в іншій копії");
  }, log),
  every(INTERVAL, "overseer-checks", async () => {
    const { skipped } = await withLock(redis, "overseer-checks", INTERVAL - 1000, tick);
    if (skipped) log.info("перевірки вже йдуть в іншій копії");
  }, log),
  every(10 * MINUTE, "overseer-report", reportTick, log),
];

log.info("overseer піднявся", { intervalMs: INTERVAL, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) });

onShutdown({
  "перевірки": () => { stopBeat(); return Promise.all(stops.map((stop) => stop())); },
  "підписка": () => sub.unsubscribe("admin"),
  "redis": () => closeRedis(),
  "postgres": () => pool.end(),
}, { log, timeoutMs: 30_000 });
