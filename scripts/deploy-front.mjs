// Викочування фронтендів на Cloudflare Workers — усіх чотирьох одним шляхом.
//
//   bun scripts/deploy-front.mjs client             # зібрати, перевірити, викотити
//   bun scripts/deploy-front.mjs admin --dry        # те саме, але нічого не заливати
//   bun scripts/deploy-front.mjs qr --if-changed    # вийти мовчки, якщо код той самий
//
// Чому не просто `wrangler deploy`: збірка Vite зашиває адресу api в бандл.
// Один раз викотивши прод із `VITE_API=http://localhost:3001`, ми отримали б
// живий сайт, який стукає в ноутбук розробника, — і зрозуміли б це лише зі
// скарг. Тому скрипт перевіряє зібране, а не наміри.
//
// Один скрипт на чотири воркери, а не чотири цілі в Makefile (23.09.2026):
// перевірки в них однакові, а робив їх раніше лише клієнт. Адмінка з тим
// самим `VITE_API` каталась повз них.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// build: чи є що збирати перед заливкою. qr і redirect — це один файл
// воркера, wrangler заливає його як є.
//
// hash: із чого рахується «джерела не змінились». Для збірки це ще й
// коренева пара package.json + bun.lock: версія vite чи react міняє бандл
// так само, як і наш код.
const APPS = {
  client: {
    dir: "frontend/client",
    build: true,
    hash: ["src", "public", "index.html", "vite.config.js", "wrangler.toml", "package.json", ".env.production"],
  },
  admin: {
    dir: "frontend/admin",
    build: true,
    hash: ["src", "public", "index.html", "vite.config.js", "wrangler.toml", "package.json", ".env.production"],
  },
  qr: { dir: "frontend/qr", build: false, hash: ["src", "wrangler.toml", "package.json"] },
  redirect: { dir: "frontend/redirect", build: false, hash: ["src", "wrangler.toml", "package.json"] },
};

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
const ifChanged = args.includes("--if-changed");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const app = APPS[name];
if (!app) fail(`вкажи застосунок: ${Object.keys(APPS).join(" | ")}`);
const DIR = path.join(ROOT, app.dir);
const DIST = path.join(DIR, "dist");

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: DIR, stdio: "inherit", shell: process.platform === "win32", ...opts });

const capture = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { cwd: DIR, encoding: "utf8", shell: process.platform === "win32" });

// ── 1. Хеш джерел ───────────────────────────────────────────────────────────
// Рахуємо по вмісту файлів, а не по git-об'єктах: скрипт запускають і з
// брудної робочої копії, і хеш має описувати те, що зараз поїде.
const files = (p) => {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).sort().flatMap((n) => files(path.join(p, n)));
};

const sum = createHash("sha256");
for (const entry of [...app.hash.map((p) => path.join(DIR, p)), path.join(ROOT, "bun.lock"), path.join(ROOT, "package.json")]) {
  for (const file of files(entry)) {
    sum.update(path.relative(ROOT, file).replaceAll("\\", "/"));
    sum.update(readFileSync(file));
  }
}
const tag = `src-${sum.digest("hex").slice(0, 16)}`;

// ── 2. Що зараз живе ────────────────────────────────────────────────────────
// Джерело правди про викочене — сам воркер, а не пам'ять CI: тег версії
// їде разом із деплоєм, тож звіряємось із тим, що зараз віддає Cloudflare.
const worker = Bun.TOML.parse(readFileSync(path.join(DIR, "wrangler.toml"), "utf8"));
function deployedTag() {
  try {
    const out = capture("bunx", ["wrangler@4", "deployments", "status", "--name", worker.name]);
    const found = out.match(/Tag:\s*(\S+)/);
    return found && found[1] !== "-" ? found[1] : null;
  } catch {
    // Воркера ще немає, немає токена, немає мережі — у всіх трьох випадках
    // відповідь однакова: ми не знаємо, що там, тож викочуємо.
    return null;
  }
}

if (ifChanged) {
  const live = deployedTag();
  if (live === tag) {
    console.log(`${name}: у Cloudflare уже ${tag} — нічого не змінилось, пропускаємо`);
    process.exit(0);
  }
  console.log(`${name}: у Cloudflare «${live ?? "невідомо"}», у цій копії ${tag} — котимо`);
}

// ── 3. Адреси, які зашиваються в бандл ──────────────────────────────────────
if (app.build) {
  // Перевіряємо до збірки, щоб не витрачати хвилину на бандл, який однаково
  // не можна викочувати.
  const envFile = path.join(DIR, ".env.production");
  if (!existsSync(envFile)) fail(`немає ${app.dir}/.env.production — нізвідки взяти VITE_API`);
  const env = readFileSync(envFile, "utf8");

  const apiUrl = (env.match(/^VITE_API=(.+)$/m) ?? [])[1]?.trim();
  if (!apiUrl) fail(`у ${app.dir}/.env.production немає VITE_API`);
  if (!/^https:\/\//.test(apiUrl)) fail(`VITE_API має бути https, а не «${apiUrl}»`);

  // Те саме про ws, і з тієї ж причини. Без VITE_WS клієнт мовчки бере
  // ws://<хост>:3002 — порт, якого в проді не існує; застосунок при цьому
  // виглядає робочим і просто ніколи не отримує подій.
  const wsUrl = (env.match(/^VITE_WS=(.+)$/m) ?? [])[1]?.trim();
  if (!wsUrl) fail(`у ${app.dir}/.env.production немає VITE_WS`);
  if (!/^wss:\/\//.test(wsUrl)) fail(`VITE_WS має бути wss, а не «${wsUrl}»`);

  console.log(`api для збірки: ${apiUrl}`);
  console.log(`ws для збірки:  ${wsUrl}`);

  // ── 4. Збірка ─────────────────────────────────────────────────────────────
  console.log("\n→ vite build");
  run("bun", ["run", "build"]);

  // ── 5. Перевірка зібраного: у бандлі не має лишитись localhost ───────────
  const bundles = readdirSync(path.join(DIST, "assets")).filter((f) => f.endsWith(".js"));
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
}

// ── 6. Нагадування про домен ───────────────────────────────────────────────
// У wrangler.toml маршрут навмисно закоментований, щоб випадковий deploy не
// перехопив прод (прив'язка робиться раз, terraform-ом). Розбираємо TOML, а
// не шукаємо рядок: routes після заголовка таблиці опиняється в ній
// (assets.routes), wrangler такого маршруту не застосує, і «перехопить»
// тоді було б неправдою.
if (!worker.routes && Object.values(worker).some((v) => v && typeof v === "object" && "routes" in v)) {
  fail(`routes у ${app.dir}/wrangler.toml опинився всередині таблиці — перенеси рядок вище першого [заголовка]`);
}
console.log(worker.routes?.length
  ? "домен: маршрут прописаний у wrangler.toml — деплой перехопить його"
  : "домен: маршрутів у wrangler.toml немає — домен привʼязує terraform (infra/terraform/cloudflare.tf)");

// ── 7. Заливка ─────────────────────────────────────────────────────────────
if (dry) {
  console.log("\n→ wrangler deploy --dry-run");
  run("bunx", ["wrangler@4", "deploy", "--dry-run"]);
  console.log(`\n✓ суха прогонка пройшла, нічого не викочено (було б ${tag})`);
  process.exit(0);
}

// Тег версії — той самий хеш джерел: наступний прогін по ньому й побачить,
// що котити нема чого. Повідомлення — коміт, з якого зібрано, щоб у списку
// версій було видно не лише «коли», а й «що».
const message = process.env.DEPLOY_MESSAGE || "";
console.log(`\n→ wrangler deploy --tag ${tag}`);
run("bunx", ["wrangler@4", "deploy", "--tag", tag, ...(message ? ["--message", message] : [])]);
console.log("\n✓ викочено");
