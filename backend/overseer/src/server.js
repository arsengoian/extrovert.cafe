// Телеметрія самого сервера для адмінки (docs/admin_panel.md, «Сервер») і
// алерти, коли він упирається в стелю (03.10.2026).
//
// Хост бачимо зсередини контейнера без жодного монтування: /proc/stat,
// /proc/meminfo і /proc/loadavg у контейнері — загальні для всього ядра, а
// statfs кореня overlay віддає розмір диска, на якому лежить
// /var/lib/docker, тобто кореневого диска дроплета (перевірено на проді:
// збігається з `df /` на хості до байта).
//
// Контейнери — через docker-proxy (docker-compose.prod.yml): сокет докера
// напряму дає повний root над хостом, а проксі пропускає лише читання
// /containers. Локально проксі немає — і контейнерів у пробі теж.
import { readFileSync, statfsSync } from "node:fs";
import { cpus } from "node:os";
import { SERVER_LIMITS } from "@extrovert/lib/server-limits.js";

const KEEP_DAYS = 31;
const DOCKER = process.env.DOCKER_PROXY_URL || null;
const TIMEOUT_MS = 5000;

// Процесор рахуємо різницею між двома пробами: лічильники в /proc/stat і
// в статистиці докера — накопичені від старту, і саме середнє за дві
// хвилини каже, чи бракує ядра. Миттєвий зріз ловив би випадкові піки.
let prevHost = null;
const prevContainers = new Map();

function hostCpu() {
  const v = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal: очікування диска —
  // простій процесора, а steal (ядро забрав сусід по гіпервізору) — ні:
  // нам цього часу так само не дісталось.
  const idle = v[3] + (v[4] || 0);
  const total = v.slice(0, 8).reduce((s, n) => s + (n || 0), 0);
  const prev = prevHost;
  prevHost = { idle, total };
  if (!prev || total <= prev.total) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
}

function memory() {
  const m = {};
  for (const line of readFileSync("/proc/meminfo", "utf8").split("\n")) {
    const [k, v] = line.split(":");
    if (v) m[k] = Number.parseInt(v, 10) * 1024;
  }
  return {
    total: m.MemTotal ?? null,
    used: m.MemTotal && m.MemAvailable !== undefined ? m.MemTotal - m.MemAvailable : null,
    swap: m.SwapTotal !== undefined ? m.SwapTotal - (m.SwapFree ?? 0) : null,
  };
}

function disk() {
  const s = statfsSync("/");
  const used = (s.blocks - s.bfree) * s.bsize;
  return { used, total: used + s.bavail * s.bsize };
}

async function docker(path) {
  const res = await fetch(`${DOCKER}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`docker ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

async function containers() {
  if (!DOCKER) return null;
  const list = await docker("/containers/json?all=1");
  const seen = new Set();
  const detail = await Promise.all(list.map(async (c) => {
    seen.add(c.Id);
    const [info, stats] = await Promise.all([
      docker(`/containers/${c.Id}/json`).catch(() => null),
      // one-shot — без другого виміру всередині докера (той чекає секунду):
      // різницю ми й так рахуємо між своїми пробами.
      c.State === "running" ? docker(`/containers/${c.Id}/stats?stream=false&one-shot=true`).catch(() => null) : null,
    ]);

    let cpu = null, mem = null, limit = null;
    if (stats?.cpu_stats) {
      const usage = stats.cpu_stats.cpu_usage?.total_usage ?? 0;
      const system = stats.cpu_stats.system_cpu_usage ?? 0;
      const prev = prevContainers.get(c.Id);
      prevContainers.set(c.Id, { usage, system });
      // Відсоток від одного ядра, як у `docker stats`: на нашому одноядерному
      // дроплеті це те саме, що від усього процесора.
      if (prev && system > prev.system) {
        cpu = Math.max(0, (100 * (usage - prev.usage) / (system - prev.system)) * (stats.cpu_stats.online_cpus || 1));
      }
      const ms = stats.memory_stats ?? {};
      // Як і в `docker stats`: неактивний файловий кеш ядро забере саме,
      // і без цього віднімання будь-який сервіс, що читав файли, виглядав би
      // ненажерливим.
      if (ms.usage !== undefined) mem = ms.usage - (ms.stats?.inactive_file ?? ms.stats?.total_inactive_file ?? 0);
      limit = ms.limit ?? null;
    }

    return {
      id: c.Id.slice(0, 12),
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      service: c.Labels?.["com.docker.compose.service"] ?? (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      // Тег образу — короткий sha коміту, з якого його зібрав CI: видно,
      // яка версія насправді крутиться.
      image: String(c.Image ?? "").split("/").pop().replace(/:([0-9a-f]{7})[0-9a-f]{33}$/, ":$1"),
      state: c.State,
      health: info?.State?.Health?.Status ?? null,
      started_at: info?.State?.StartedAt ?? null,
      restarts: info?.RestartCount ?? 0,
      oom: Boolean(info?.State?.OOMKilled),
      cpu: cpu === null ? null : Math.round(cpu * 10) / 10,
      mem,
      limit,
    };
  }));
  for (const id of prevContainers.keys()) if (!seen.has(id)) prevContainers.delete(id);
  return detail.sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name));
}

export async function sampleServer({ pool, redis, log }) {
  const warn = (what, e) => log?.warn({ err: e.message }, `телеметрія сервера: ${what}`);
  const s = { cpu: null, cpus: null, load1: null, mem: {}, disk: {}, databases: {}, redis: null, containers: null };

  // Кожне джерело окремо: зламаний проксі докера не має забирати з
  // графіка процесор, а недоступний /proc (локально на Windows) — базу.
  try { s.cpu = hostCpu(); } catch (e) { warn("процесор", e); }
  try { s.cpus = cpus().length || null; } catch { /* немає — то й немає */ }
  try { s.load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]); } catch { /* лише Linux */ }
  try { s.mem = memory(); } catch (e) { warn("памʼять", e); }
  try { s.disk = disk(); } catch (e) { warn("диск", e); }
  try {
    const { rows } = await pool.query(
      // Службова postgres — кілька мегабайтів, що ніколи не ростуть.
      "select datname, pg_database_size(datname)::bigint as bytes from pg_database where not datistemplate and datallowconn and datname <> 'postgres'"
    );
    s.databases = Object.fromEntries(rows.map((r) => [r.datname, Number(r.bytes)]));
  } catch (e) { warn("бази", e); }
  try {
    const m = /used_memory:(\d+)/.exec(await redis.info("memory"));
    s.redis = m ? Number(m[1]) : null;
  } catch (e) { warn("redis", e); }
  try { s.containers = await containers(); } catch (e) { warn("контейнери", e); }

  // Компактно — по сервісу: копії api під час викочування складаємо, бо
  // ім'я контейнера (api-1, api-2) після кожного деплою інше, і на графіку
  // сервіс розсипався б на уривки.
  const byService = {};
  for (const c of s.containers ?? []) {
    if (c.state !== "running") continue;
    const cur = byService[c.service] ?? { cpu: null, mem: 0, restarts: 0 };
    if (c.cpu !== null) cur.cpu = Math.round(((cur.cpu ?? 0) + c.cpu) * 10) / 10;
    cur.mem += c.mem ?? 0;
    cur.restarts += c.restarts;
    byService[c.service] = cur;
  }

  await pool.query(
    `insert into server_samples (cpu_pct, cpus, load1, mem_used, mem_total, swap_used, disk_used, disk_total, databases, redis_bytes, containers)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (taken_at) do nothing`,
    [s.cpu, s.cpus, s.load1, s.mem.used ?? null, s.mem.total ?? null, s.mem.swap ?? null,
      s.disk.used ?? null, s.disk.total ?? null, s.databases, s.redis, byService]
  );
  // Подробиці контейнерів — лише останні, і в Redis: стан, аптайм і образ
  // потрібні таблиці «зараз», а не графіку за місяць. Десять хвилин життя —
  // щоб застиглий overseer не показував учорашню таблицю як сьогоднішню.
  if (s.containers) {
    await redis.set("server:containers", JSON.stringify({ at: new Date().toISOString(), list: s.containers }), "EX", 600);
  }
  await pool.query("delete from server_samples where taken_at < now() - make_interval(days => $1)", [KEEP_DAYS]);

  const pct = (a, b) => (a !== null && a !== undefined && b ? `${Math.round((100 * a) / b)}%` : "—");
  return { done: `CPU ${s.cpu === null ? "—" : `${Math.round(s.cpu)}%`}, памʼять ${pct(s.mem.used, s.mem.total)}, диск ${pct(s.disk.used, s.disk.total)}, контейнерів ${s.containers?.length ?? "—"}` };
}

const GB = (n) => `${(n / 1024 ** 3).toFixed(1)} ГБ`;

// Стан для алертів overseer (index.js, tick): «high» / «ok» або null —
// «без змін»: значення між calm і high, або проб замало, щоб судити.
// null не записується як стан, тож біля самої межі алерт не моргає.
export async function checkServer(pool) {
  const need = Math.max(...Object.values(SERVER_LIMITS).map((l) => l.samples));
  // Лише свіжі проби: застиглий збирач не має тримати «усе гаразд» чи
  // «усе погано» з години тому.
  const { rows } = await pool.query(
    `select cpu_pct, mem_used, mem_total, disk_used, disk_total from server_samples
      where taken_at > now() - interval '15 minutes'
      order by taken_at desc limit $1`,
    [need]
  );
  const out = [];
  const judge = (key, values, limit) => {
    const last = values.slice(0, limit.samples).filter((v) => v !== null && Number.isFinite(v));
    if (last.length < limit.samples) return null;
    if (last.every((v) => v >= limit.high)) return { key, state: "high", value: last[0] };
    if (last.every((v) => v < limit.calm)) return { key, state: "ok", value: last[0] };
    return null;
  };
  const pctOf = (a, b) => (a === null || !b ? null : (100 * Number(a)) / Number(b));

  const cpu = judge("cpu", rows.map((r) => r.cpu_pct), SERVER_LIMITS.cpu);
  if (cpu) out.push({ ...cpu, text: cpu.state === "high"
    ? `🔥 Сервер: процесор ${Math.round(cpu.value)}% уже ${SERVER_LIMITS.cpu.samples * 2} хв`
    : `✅ Сервер: процесор відпустило, ${Math.round(cpu.value)}%` });

  const mem = judge("mem", rows.map((r) => pctOf(r.mem_used, r.mem_total)), SERVER_LIMITS.mem);
  if (mem) out.push({ ...mem, text: mem.state === "high"
    ? `🧠 Сервер: памʼять зайнята на ${Math.round(mem.value)}% (${GB(Number(rows[0].mem_used))} з ${GB(Number(rows[0].mem_total))}) уже ${SERVER_LIMITS.mem.samples * 2} хв — далі OOM`
    : `✅ Сервер: памʼять знову ${Math.round(mem.value)}%` });

  const dsk = judge("disk", rows.map((r) => pctOf(r.disk_used, r.disk_total)), SERVER_LIMITS.disk);
  if (dsk) out.push({ ...dsk, text: dsk.state === "high"
    ? `💽 Сервер: диск заповнений на ${Math.round(dsk.value)}%, вільно ${GB(Number(rows[0].disk_total) - Number(rows[0].disk_used))}`
    : `✅ Сервер: на диску знову місце, ${Math.round(dsk.value)}%` });

  return out;
}

// Контейнер, що перезапустився сам (упав, OOM): докер піднімає його за
// restart: unless-stopped, і без цього падіння лишилось би непоміченим —
// проби здоровʼя бачать лише, що він знову живий. Викочування сюди не
// потрапляє: воно створює нові контейнери з лічильником 0.
//
// Лічильник порівнюємо з тим, що бачили в попередній пробі того самого
// контейнера; новий контейнер мовчки запамʼятовуємо.
export async function containerRestarts(redis) {
  const raw = await redis.get("server:containers");
  if (!raw) return [];
  const { list = [] } = JSON.parse(raw);
  const out = [];
  for (const c of list) {
    const key = `overseer:restarts:${c.id}`;
    const prev = await redis.get(key);
    await redis.set(key, String(c.restarts), "EX", 30 * 86400);
    if (prev === null || c.restarts <= Number(prev)) continue;
    out.push(`♻️ ${c.service}: контейнер перезапустився сам${c.restarts > 1 ? ` (уже ${c.restarts}-й раз)` : ""}${c.oom ? " — вбив OOM-killer" : ""}`);
  }
  return out;
}
