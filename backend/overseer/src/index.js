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
import { checkDevices, checkMenuAcks, checkMenuCheckbox, checkPoints, checkReceiptPrices, checkWebhook, dailyReport, outageKind } from "./checks.js";
import { ACK_DEADLINE_MIN } from "@extrovert/lib/deployments.js";
import { sampleHealth } from "./health.js";
import { checkServer, containerRestarts, sampleServer } from "./server.js";
import { send } from "./telegram.js";

const log = makeLog("overseer");
initErrors("overseer", { log });
const redis = redisClient();

const MINUTE = 60_000;
const INTERVAL = Number(process.env.OVERSEER_INTERVAL_MS || 5 * MINUTE);

// Повідомляємо лише про зміну стану — і пам'ятаємо попередній у Redis, щоб
// перезапуск сервісу не перетворювався на нову хвилю алертів.
//
// Сам текст звідси НЕ відправляється: обхід збирає всі зміни й шле їх одним
// повідомленням (див. tick). Коли точку знеструмили, одночасно міняються
// пʼять станів — пʼять окремих сповіщень підряд читаються гірше за один
// список і виглядають як пʼять різних поломок (прохання власника,
// 24.09.2026).
async function changed(key, state) {
  const previous = await redis.get(`overseer:${key}`);
  if (previous === state) return false;
  await redis.set(`overseer:${key}`, state);
  // Перший запуск після порожнього Redis: стан запам'ятовуємо, але мовчимо,
  // якщо він добрий — інакше кожен деплой вітався б купою «усе гаразд».
  return !(previous === null && state === "ok");
}

// Подія, яка сталася один раз (перезавантаження точки): ключ унікальний
// сам по собі, тож досить запамʼятати, що ми про нього вже казали. Тиждень
// життя — щоб Redis не збирав ключі назавжди.
async function first(key) {
  return Boolean(await redis.set(`overseer:${key}`, "1", "EX", 7 * 86400, "NX"));
}

async function tick() {
  const lines = [];

  const points = await checkPoints(pool);
  for (const p of points) {
    if (!(await changed(`point:${p.id}`, p.state))) continue;
    if (p.state !== "ok") { lines.push(`🔌 ${p.name}: мовчить ${p.silentFor}`); continue; }
    // Повернулась — кажемо не лише «жива», а й що це було. Проби з черги
    // доїжджають у тій самій пачці, що й свіжа, тож на цей момент відповідь
    // уже лежить у базі (checks.js, outageKind).
    const why = await outageKind(pool, p.id);
    lines.push(`✅ ${p.name}: знову на звʼязку${why ? ` — ${why}` : ""}`);
  }

  // Поломки залізяки: монітор, живлення, картка, кіоск, диск, флешка,
  // температура, мережа, памʼять — і окремо факт перезавантаження.
  for (const d of await checkDevices(pool)) {
    const say = d.once ? await first(`device:${d.key}`) : await changed(`device:${d.key}`, d.state);
    if (say) lines.push(d.text);
  }

  // Нове меню не зʼявилось на екрані: кіоск не підтвердив за кілька хвилин.
  // Нічого не відкочується — меню в бакеті, кіоск підхопить його сам, і
  // тоді прийде «знову на екрані» (lib/deployments.js).
  for (const m of await checkMenuAcks(pool)) {
    if (!(await changed(`menu-ack:${m.id}`, m.state))) continue;
    lines.push(m.state === "ok"
      ? `✅ ${m.name}: меню на екрані знову актуальне`
      : `🖥 ${m.name}: нове меню (деплой №${m.deployment}) не зʼявилось на екрані за ${ACK_DEADLINE_MIN} хв — кіоск не підтвердив`);
  }

  // Ціни не доїхали в каталог Checkbox — каса пробиватиме не те, що на екрані.
  for (const m of await checkMenuCheckbox(pool)) {
    if (!(await changed(`menu-checkbox:${m.id}`, m.state))) continue;
    lines.push(m.state === "ok"
      ? `✅ ${m.name}: ціни в Checkbox знову збігаються з меню`
      : `💳 ${m.name}: ціни деплою №${m.deployment} не записались у Checkbox — ${m.error ?? "без пояснення"}`);
  }

  // Ціна в чеку розійшлась із меню — автомат пробиває свій прайс.
  for (const c of await checkReceiptPrices(pool)) {
    if (await changed(`receipt-price:${c.key}`, c.state)) lines.push(c.text);
  }

  const webhook = await checkWebhook();
  // «unknown» — це не поломка, а «не змогли спитати»: мовчимо.
  if (webhook && webhook.state !== "unknown" && await changed("checkbox-webhook", webhook.state)) {
    lines.push(webhook.state === "ok"
      ? "✅ Вебхук Checkbox: помилок немає"
      : `⚠️ Вебхук Checkbox: ${webhook.message}`);
  }

  // Сам сервер: процесор, памʼять і диск біля стелі, контейнер, що впав і
  // піднявся сам (server.js; пороги — lib/server-limits.js).
  for (const c of await checkServer(pool)) {
    if (await changed(`server:${c.key}`, c.state)) lines.push(c.text);
  }
  lines.push(...(await containerRestarts(redis)));

  // Поганим — нагору: коли в одному повідомленні і «картка read-only», і
  // «монітор увімкнено», перше має бути першим рядком, бо саме його читають
  // з екрана блокування.
  if (lines.length) await send(lines.sort((a, b) => a.startsWith("✅") - b.startsWith("✅")).join("\n"), { log });
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

// Замовлення за зерна — теж одразу (власник, 02.10.2026): що, кому, куди й
// чим друкувати. Телефон і імʼя отримувача — свідомо: з ними посилку
// збирають і відправляють, не відкриваючи адмінку. Текст від гравців
// (нікнейм, імʼя, адреса) екрануємо — повідомлення йде з parse_mode HTML.
const ADMIN_URL = process.env.ADMIN_URL || "https://admin.extrovert.cafe";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const OPTION = { size: "розмір" };

function orderText(e) {
  const options = Object.entries(e.options ?? {}).map(([k, v]) => `${OPTION[k] ?? k} ${v}`).join(", ");
  return [
    `📦 Нове замовлення №${e.order_id}${e.nickname ? ` від ${esc(e.nickname)}` : ""}`,
    `${esc(e.product)}${options ? ` (${esc(options)})` : ""} — ${e.beans} зерен`,
    e.print ? `Принт: кавенятко «${esc(e.print.plant || "без імені")}», стадія ${e.print.stage} — PNG прийде окремо` : null,
    `Отримувач: ${esc(e.recipient_name)}, ${esc(e.recipient_phone)}`,
    `Нова Пошта: ${esc(e.address)}`,
    `${ADMIN_URL}/#/orders/${e.order_id}`,
  ].filter(Boolean).join("\n");
}

// Файл для друкарні — прямим посиланням на тиждень (довше R2 не підписує):
// його відкривають, коли передають замовлення в друк, а не в ту ж хвилину.
function printText(e) {
  let link = null;
  try {
    link = presign({ method: "GET", purpose: "uploads", key: e.key, expiresIn: 7 * 24 * 3600, filename: `принт-${e.order_id}.png` }).url;
  } catch (err) {
    log.warn({ err: err.message }, "не підписали посилання на принт");
  }
  return [
    `🖼 Принт до замовлення №${e.order_id}${e.plant ? ` — «${esc(e.plant)}»` : ""}`,
    link ? `<a href="${esc(link)}">Завантажити PNG</a>` : `Файл — в адмінці: ${ADMIN_URL}/#/orders/${e.order_id}`,
  ].join("\n");
}

const sub = redisClient();
await sub.subscribe("admin");
sub.on("message", async (_channel, raw) => {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (event.event === "order_created") { await send(orderText(event), { log }); return; }
  if (event.event === "order_print_ready") { await send(printText(event), { log }); return; }
  if (event.event !== "problem_reported") return;
  const what = (event.categories ?? []).map((c) => CATEGORY[c] ?? c).join(", ");
  // Фото — прямим посиланням, а не файлом: бакет приватний, і тягнути
  // мегабайти через бота, щоб їх потім тримав телеграм, немає за що.
  // Доба — щоб посилання лишалось робочим, коли алерт читають зранку
  // (прохання власника 24.09.2026).
  // Кілька фото (з 03.10.2026) — по посиланню на кожне; image_key — подія,
  // що лежала в outbox зі старого api.
  const keys = event.image_keys ?? (event.image_key ? [event.image_key] : []);
  const photos = [];
  for (const key of keys) {
    try {
      photos.push(presign({ method: "GET", purpose: "uploads", key, expiresIn: 24 * 3600 }).url);
    } catch (e) {
      log.warn({ err: e.message }, "не підписали посилання на фото скарги");
    }
  }
  const lines = [
    `🛠 Нова скарга${event.nickname ? ` від ${event.nickname}` : " (без входу)"}`,
    what ? `Про що: ${what}` : null,
    event.preview ? `«${event.preview}»` : null,
    ...(photos.length ? photos : event.photo ? ["З фото"] : []),
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
  // Телеметрія сервера — з тим самим кроком, що й проби: на графіку за
  // 6 годин це 180 точок, і пік на чотири хвилини не губиться.
  every(2 * MINUTE, "server-samples", async () => {
    const { skipped } = await withLock(redis, "server-samples", 110_000, () => sampleServer({ pool, redis, log }));
    if (skipped) log.info("телеметрія сервера вже йде в іншій копії");
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
