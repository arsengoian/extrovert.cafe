// Деплой застосунку гравця на Cloudflare Workers (статика + SPA-фолбек).
//
//   bun run deploy:client --dry     # зібрати й показати, що поїде
//   bun run deploy:client           # зібрати й викотити
//
// Чому не просто `wrangler deploy`: збірка Vite зашиває адресу api в
// бандл. Один раз викотивши прод із `VITE_API=http://localhost:3001`, ми
// отримали б живий сайт, який стукає в ноутбук розробника, — і зрозуміли б
// це лише зі скарг. Тому скрипт перевіряє зібране, а не наміри.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client");
const DIST = path.join(CLIENT, "dist");
const dry = process.argv.includes("--dry");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: CLIENT, stdio: "inherit", shell: process.platform === "win32", ...opts });

const capture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: CLIENT, encoding: "utf8", shell: process.platform === "win32" });

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// 1. Адреса api. Її бере Vite з .env.production — перевіряємо до збірки,
// щоб не витрачати хвилину на бандл, який однаково не можна викочувати.
const envFile = path.join(CLIENT, ".env.production");
if (!existsSync(envFile)) fail("немає client/.env.production — нізвідки взяти VITE_API");
const apiUrl = (readFileSync(envFile, "utf8").match(/^VITE_API=(.+)$/m) ?? [])[1]?.trim();
if (!apiUrl) fail("у client/.env.production немає VITE_API");
if (!/^https:\/\//.test(apiUrl)) fail(`VITE_API має бути https, а не «${apiUrl}»`);
console.log(`api для збірки: ${apiUrl}`);

// 2. Збірка.
console.log("\n→ vite build");
run("bun", ["run", "build"]);

// 3. Перевірка зібраного: у бандлі не має лишитись localhost.
const files = readdirSync(path.join(DIST, "assets"));
const bundles = files.filter((f) => f.endsWith(".js"));
let bytes = 0;
for (const f of readdirSync(DIST, { recursive: true })) {
  const full = path.join(DIST, String(f));
  if (statSync(full).isFile()) bytes += statSync(full).size;
}
for (const f of bundles) {
  const code = readFileSync(path.join(DIST, "assets", f), "utf8");
  if (code.includes("localhost:3001") || code.includes("127.0.0.1:3001")) {
    fail(`у ${f} лишилась локальна адреса api — збірка зроблена не з .env.production`);
  }
}
console.log(`\nзібрано: ${bundles.length} js, усього ${(bytes / 1024 / 1024).toFixed(2)} МБ`);

// 4. Нагадування про домен: у wrangler.toml маршрут навмисно закоментований,
// щоб випадковий deploy не перехопив прод (прив'язка робиться раз у
// дашборді Cloudflare).
const wrangler = readFileSync(path.join(CLIENT, "wrangler.toml"), "utf8");
const bound = /^\s*routes\s*=/m.test(wrangler);
console.log(bound
  ? "домен: маршрут прописаний у wrangler.toml — деплой перехопить його"
  : "домен: маршрутів у wrangler.toml немає, поїде на *.workers.dev (прод привʼязується в дашборді)");

if (dry) {
  console.log("\n→ wrangler deploy --dry-run");
  run("bunx", ["wrangler@4", "deploy", "--dry-run"]);
  console.log("\n✓ суха прогонка пройшла, нічого не викочено");
  process.exit(0);
}

console.log("\n→ wrangler deploy");
run("bunx", ["wrangler@4", "deploy"]);
console.log("\n✓ викочено");

// Одразу показуємо, що саме тепер живе — щоб не йти за цим у дашборд.
try {
  console.log(capture("bunx", ["wrangler@4", "deployments", "list"]).split("\n").slice(0, 12).join("\n"));
} catch {
  // Не критично: список деплоїв — зручність, а не частина викочування.
}
