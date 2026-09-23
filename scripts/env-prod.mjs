// .env.prod — оточення продового сервера. Живе на машині розробника поруч
// із .env (у git його немає) і їде на сервер цілим файлом: там
// /opt/extrovert/.env — симлінк на .env.prod (docs/deploy.md §2).
//
//   bun scripts/env-prod.mjs init    — зібрати з локального .env (лише якщо файлу ще немає)
//   bun scripts/env-prod.mjs check   — чи збігаються ключі й порядок із .env.example
//   bun scripts/env-prod.mjs push    — залити на сервер; TAG, який там поставив rollout.sh, лишається
//
// Значення не друкуються ніколи — у вивід ідуть лише імена ключів.
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, ".env.prod");
const DIR = "/opt/extrovert";

const lines = (file) => readFileSync(file, "utf8").split(/\r?\n/);
const keyOf = (line) => line.match(/^([A-Z0-9_]+)=/)?.[1];
const valueOf = (line) => {
  const rest = line.slice(line.indexOf("=") + 1);
  return /^\s+#/.test(rest) ? "" : rest.replace(/\s+#.*$/, "").trim();
};
const commentOf = (line) => line.slice(line.indexOf("=") + 1).match(/(\s+#.*)$/)?.[1] ?? "";

// Що на сервері інакше, ніж локально.
//   • адреси й оточення — продові;
//   • секрети, які ми генеруємо самі (пароль бази, ключ підпису токенів,
//     ключ GlitchTip), — свої: локальний ключ JWT, що підписує й прод,
//     дозволяв би з ноутбука випускати токени для живих гравців;
//   • те, що потрібне лише на машині розробника (terraform, wrangler,
//     MinIO, тестові облікові записи Checkbox), лишається порожнім: на
//     сервері цих ключів бути не повинно.
function overrides(vectorStore) {
  const jwt = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
  return {
    APP_ENV: "production",
    REDIS_URL: "redis://redis:6379",
    APP_ORIGIN: "https://extrovert.cafe",
    API_ORIGIN: "https://api.extrovert.cafe",
    // Порожньо — і адреса повернення Google береться з API_ORIGIN. Локальне
    // значення (localhost) на прод потрапити не має.
    OAUTH_ORIGIN: "",
    GLITCHTIP_DOMAIN: "https://errors.extrovert.cafe",
    POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
    JWT_PRIVATE_KEY: jwt,
    GLITCHTIP_SECRET_KEY: randomBytes(40).toString("base64url"),
    OPENAI_VECTOR_STORE: vectorStore ?? "",
    TAG: "latest",
    DATABASE_URL_LOCAL: "",
    R2_DEV_ENDPOINT: "", R2_DEV_ACCESS_KEY_ID: "", R2_DEV_SECRET_ACCESS_KEY: "",
    CHECKBOX_TEST_LOGIN: "", CHECKBOX_TEST_PASSWORD: "", CHECKBOX_TEST_LICENSE_KEY: "",
    CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "",
    DIGITALOCEAN_API_KEY: "", GHCR_TOKEN: "",
  };
}

function init() {
  if (existsSync(FILE) && !process.argv.includes("--force")) {
    console.error("✗ .env.prod уже є — правь його руками (або --force, щоб зібрати заново з новими секретами)");
    process.exit(1);
  }
  const vs = process.argv.find((a) => a.startsWith("--vector-store="))?.split("=")[1];
  const local = new Map(lines(path.join(ROOT, ".env")).map((l) => [keyOf(l), l]).filter(([k]) => k));
  const set = overrides(vs);
  const out = lines(path.join(ROOT, ".env.example")).map((line) => {
    const key = keyOf(line);
    if (!key) return line;
    if (key in set) return `${key}=${set[key]}${commentOf(line)}`;
    return local.get(key) ?? line;
  });
  writeFileSync(FILE, out.join("\n"));
  try { chmodSync(FILE, 0o600); } catch {}
  console.log("✓ .env.prod зібрано з .env за структурою .env.example");
  console.log("  інакше, ніж локально:", Object.keys(set).filter((k) => set[k]).join(", "));
  console.log("  порожні на сервері:", Object.keys(set).filter((k) => !set[k]).join(", "));
}

function check() {
  const wantKeys = lines(path.join(ROOT, ".env.example")).map(keyOf).filter(Boolean);
  const haveKeys = lines(FILE).map(keyOf).filter(Boolean);
  const missing = wantKeys.filter((k) => !haveKeys.includes(k));
  const extra = haveKeys.filter((k) => !wantKeys.includes(k));
  const sameOrder = JSON.stringify(wantKeys.filter((k) => haveKeys.includes(k))) === JSON.stringify(haveKeys.filter((k) => wantKeys.includes(k)));
  const empty = lines(FILE).filter((l) => keyOf(l) && !valueOf(l)).map(keyOf);
  console.log(missing.length ? `✗ бракує: ${missing.join(", ")}` : "✓ усі ключі .env.example на місці");
  if (extra.length) console.log(`· зайві (немає в .env.example): ${extra.join(", ")}`);
  if (!sameOrder) console.log("· порядок ключів відрізняється від .env.example");
  console.log(`· порожні: ${empty.join(", ") || "—"}`);
  if (missing.length) process.exit(1);
}

// Сервер — зі стану terraform, як і в act-secrets.mjs: адресу руками не
// переписуємо, щоб одного дня не залити оточення на старий дроплет.
function host() {
  const state = JSON.parse(readFileSync(path.join(ROOT, "infra", "terraform", "terraform.tfstate"), "utf8"));
  const droplet = state.resources.find((r) => r.type === "digitalocean_droplet" && r.name === "public");
  return droplet?.instances?.[0]?.attributes?.ipv4_address;
}

function push() {
  const ip = host();
  if (!ip) { console.error("✗ terraform не знає адреси дроплета"); process.exit(1); }
  const key = path.join(ROOT, "keys", "extrovert_ed25519");
  const ssh = (script, input) => spawnSync("ssh", ["-i", key, "-p", "2222", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", `root@${ip}`, script], { input, encoding: "utf8" });

  // TAG на сервері пише rollout.sh — це версія, яка зараз крутиться.
  // Локальний файл про неї не знає, тож беремо серверну.
  const current = ssh(`grep -m1 '^TAG=' ${DIR}/.env.prod 2>/dev/null || true`).stdout.trim();
  const body = lines(FILE).map((l) => (keyOf(l) === "TAG" && current ? current : l)).join("\n");

  // Через тимчасовий файл і mv: обірване зʼєднання не лишить на сервері
  // пів оточення. Симлінк .env — щоб docker compose бачив його без -f.
  const r = ssh(
    `set -e; mkdir -p ${DIR}; umask 077; cat > ${DIR}/.env.prod.tmp; mv ${DIR}/.env.prod.tmp ${DIR}/.env.prod; ` +
    `if [ -f ${DIR}/.env ] && [ ! -L ${DIR}/.env ]; then mv ${DIR}/.env ${DIR}/.env.before-symlink; fi; ` +
    `ln -sfn .env.prod ${DIR}/.env; echo "ok $(grep -c '=' ${DIR}/.env.prod) рядків"`,
    body.endsWith("\n") ? body : `${body}\n`
  );
  if (r.status !== 0) { console.error("✗", r.stderr.trim()); process.exit(1); }
  console.log(`✓ ${ip}:${DIR}/.env.prod (${r.stdout.trim()}), .env → .env.prod${current ? `, ${current} зі сервера` : ""}`);
}

const commands = { init, check, push };
const cmd = process.argv[2];
if (!commands[cmd]) { console.error("команди: init | check | push"); process.exit(1); }
if (cmd !== "init" && !existsSync(FILE)) { console.error("✗ немає .env.prod — bun scripts/env-prod.mjs init"); process.exit(1); }
commands[cmd]();
