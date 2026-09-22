// Щоденний дамп Postgres у R2 — бакет extrovert-backups, lifecycle 30 днів
// (infra/terraform/cloudflare.tf, docs/deploy.md §2.2).
//
// pg_dump у форматі custom: він уже стиснутий і відновлюється вибірково —
// одну таблицю (pg_restore --table), а не лише всю базу. Раз на добу за UTC:
// робота щогодини питає бакет, чи є вже сьогоднішній файл, і робить дамп,
// лише якщо немає. Джерело правди про «вже зроблено» — сам бакет, а не
// памʼять процесу: scheduler, що лежав уночі, наздоганяє пропуск тієї ж
// години, як піднявся, і двічі за добу дамп не робиться навіть на двох
// копіях сервісу (їх і так розводить блокування в Redis).
//
// pg_dump живе в образі scheduler (docker/bun.Dockerfile) і має бути тієї ж
// мажорної версії, що й сервер (16): старіший відмовиться дампити, новіший
// не потрібен. Піднімуть postgres в compose — піднімати й тут.
import { spawn } from "node:child_process";
import { databaseUrl } from "@extrovert/lib/db.js";
import { presign, put } from "@extrovert/lib/r2.js";

async function exists(key) {
  const { url } = presign({ method: "HEAD", purpose: "backups", key, expiresIn: 60 });
  const res = await fetch(url, { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HEAD ${key}: ${res.status}`);
  return true;
}

// Пароль — через PGPASSWORD, а не в аргументах: рядок запуску процесу видно
// в ps кожному в контейнері.
function dump() {
  const u = new URL(databaseUrl);
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1),
    PGSSLMODE: u.searchParams.get("sslmode") || "prefer",
  };
  return new Promise((resolve, reject) => {
    const p = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    p.stdout.on("data", (c) => chunks.push(c));
    p.stderr.on("data", (c) => { err += c; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`pg_dump завершився з ${code}: ${err.trim().slice(0, 300)}`))));
  });
}

let missingTool = false;

export async function backupDatabase({ log, now = new Date() }) {
  // Локально pg_dump зазвичай немає — це не аварія, а просто не той
  // комп'ютер: кажемо один раз і далі мовчимо.
  if (missingTool) return {};
  const key = `postgres/${now.toISOString().slice(0, 10)}.dump`;
  if (await exists(key)) return {};

  const started = Date.now();
  let body;
  try {
    body = await dump();
  } catch (e) {
    if (e.code === "ENOENT") {
      missingTool = true;
      log.warn("pg_dump не знайдений — бекапи бази тут не робляться (вони живуть в образі scheduler)");
      return {};
    }
    throw e;
  }
  await put({ purpose: "backups", key, body, contentType: "application/octet-stream" });
  const mb = (body.length / 1024 / 1024).toFixed(1);
  return { done: `${key}: ${mb} МБ за ${((Date.now() - started) / 1000).toFixed(1)} с` };
}
