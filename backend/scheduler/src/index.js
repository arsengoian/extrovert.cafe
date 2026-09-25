// Scheduler: усе, що робиться за розкладом, а не у відповідь на запит
// (services.md §2). Окремий процес, бо такі роботи не мають конкурувати з
// живими запитами гравців, їх видно окремо в логах і перезапустити їх можна,
// не чіпаючи api.
//
// Кожна робота бере блокування в Redis (`lock:<job>`), тож дві копії
// сервісу не роблять те саме; довгі синхронізації тримають курсор у
// sync_cursors.
import { pool } from "@extrovert/lib/db.js";
import { redisClient, closeRedis } from "@extrovert/lib/redis.js";
import { onShutdown } from "@extrovert/lib/shutdown.js";
import { makeLog } from "@extrovert/lib/log.js";
import { initErrors } from "@extrovert/lib/errors.js";
import { every, heartbeat, withLock } from "@extrovert/lib/jobs.js";
import { publishOutbox } from "./jobs/outbox.js";
import { flushImpressions } from "./jobs/impressions.js";
import { syncDirectory, trackShipments } from "./jobs/novaposhta.js";
import { deployMenus } from "./jobs/menu.js";
import { backupDatabase } from "./jobs/backup.js";

const log = makeLog("scheduler");
initErrors("scheduler", { log });
const redis = redisClient();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Інтервали — не константи «бо так гарно»: виходять з того, як швидко
// новина має дійти й скільки коштує запит.
const JOBS = [
  { name: "outbox", every: 500, ttl: 5_000, run: () => publishOutbox({ pool, redis, log }) },
  { name: "market-impressions", every: MINUTE, ttl: 55_000, run: () => flushImpressions({ pool, redis, log }) },
  // Десять секунд: людина натиснула «викотити меню» й чекає, поки цифри
  // на екрані зміняться. Запит дешевий — один select у порожню чергу.
  { name: "menu-deploy", every: 10_000, ttl: 60_000, run: () => deployMenus({ pool, log }) },
  { name: "np-tracking", every: HOUR, ttl: 50 * MINUTE, run: () => trackShipments({ pool, log }) },
  { name: "np-directory", every: 6 * HOUR, ttl: 3 * HOUR, run: () => syncDirectory({ pool, log }) },
  // Щогодини лише перевірка «чи є сьогоднішній дамп» — сам дамп раз на добу.
  { name: "db-backup", every: HOUR, ttl: 50 * MINUTE, run: () => backupDatabase({ log }) },
];

// Порту в scheduler немає — про те, що він живий, каже позначка в Redis.
const stopBeat = heartbeat(redis, "scheduler");

const stops = JOBS.map((job) =>
  every(job.every, job.name, async () => {
    const { skipped, result } = await withLock(redis, job.name, job.ttl, job.run);
    if (skipped) return;
    if (result?.done) log.info(`${job.name}: ${result.done}`, result.extra);
  }, log)
);

log.info("scheduler піднявся", { jobs: JOBS.map((j) => j.name) });

// stop() тепер чекає, поки поточний прохід роботи допрацює: робота,
// вбита посередині, лишає по собі взяте блокування й недописаний курсор.
onShutdown({
  "роботи": () => { stopBeat(); return Promise.all(stops.map((stop) => stop())); },
  "redis": () => closeRedis(),
  "postgres": () => pool.end(),
}, { log, timeoutMs: 40_000 });
