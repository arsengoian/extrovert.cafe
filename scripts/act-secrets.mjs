// Готує .secrets для act — щоб той самий workflow, що й на GitHub, можна
// було ганяти локально.
//
// Файл збирається з того, що вже є на машині: приватний ключ із keys/,
// адреса дроплета зі стану terraform, токен реєстру з .env. Нічого нового
// вигадувати не треба, і жодне значення не друкується — у вивід іде лише
// перелік ключів.
//
// .secrets у git не потрапляє (.gitignore), і це не формальність: у ньому
// лежить приватний ключ від сервера.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".secrets");

// Мінімальний парсер .env: нам звідти потрібні одне-два значення, тягти
// залежність заради цього немає сенсу.
function readEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// Адреса сервера — зі стану terraform: він і так джерело правди про те,
// який дроплет зараз живий, і переписувати її руками означало б одного дня
// викотити на старий.
function serverFromTerraform() {
  const file = path.join(ROOT, "infra", "terraform", "terraform.tfstate");
  if (!existsSync(file)) return null;
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    for (const r of state.resources ?? []) {
      if (r.type === "digitalocean_droplet" && r.name === "public") {
        return r.instances?.[0]?.attributes?.ipv4_address ?? null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const env = readEnv();
const keyFile = path.join(ROOT, "keys", "extrovert_ed25519");
if (!existsSync(keyFile)) {
  console.error("✗ немає keys/extrovert_ed25519 — зроби `make keys-ssh`");
  process.exit(1);
}

const host = serverFromTerraform() || env.SERVER_HOST;
if (!host) {
  console.error("✗ не знайшов адресу сервера: ні в стані terraform, ні в SERVER_HOST");
  process.exit(1);
}

const secrets = {
  SSH_PRIVATE_KEY: readFileSync(keyFile, "utf8").trim(),
  SERVER_HOST: host,
  SERVER_PORT: env.SERVER_PORT || "2222",
  SERVER_USER: env.SERVER_USER || "root",
  GHCR_TOKEN: env.GHCR_TOKEN || "",
};

// Багаторядкове значення в подвійних лапках: саме так його читає парсер act.
const body = Object.entries(secrets)
  .map(([k, v]) => (v.includes("\n") ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`))
  .join("\n");

writeFileSync(OUT, `${body}\n`);
try {
  chmodSync(OUT, 0o600);
} catch {
  // На Windows це нічого не змінює — файл і так поза git.
}

console.log("✓ .secrets готовий:", Object.keys(secrets).join(", "));
if (!secrets.GHCR_TOKEN) {
  console.log("  GHCR_TOKEN порожній — локальна збірка образів працює, пуш у реєстр ні.");
  console.log("  Потрібен — заведи токен GitHub з write:packages і поклади в .env як GHCR_TOKEN.");
}
console.log("  сервер:", `${secrets.SERVER_USER}@${host}:${secrets.SERVER_PORT}`);
