// Ключі, які потрібні розробнику й серверу.
//
//   bun scripts/keys.mjs jwt        — Ed25519 для підпису токенів, одним рядком у .env
//   bun scripts/keys.mjs ssh        — ключ доступу до малини й дроплетів (keys/, у git не їде)
//   bun scripts/keys.mjs ssh --show — показати публічну частину наявного ключа
//
// Приватні частини не друкуються ніколи, крім JWT: той за визначенням
// живе в .env, і сенсу ховати його від того, хто цей .env і заповнює,
// немає.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = path.join(ROOT, "keys");
const SSH_KEY = path.join(KEYS, "extrovert_ed25519");

const [command, ...rest] = process.argv.slice(2);

function jwt() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  // .env не розуміє багаторядкових значень, тому переноси екрануються;
  // api/src/auth.js розгортає їх назад.
  console.log("Додай у .env одним рядком:\n");
  console.log(`JWT_PRIVATE_KEY=${pem.trim().replace(/\n/g, "\\n")}`);
  console.log("\nКлюч не зберігається нікуди більше: якщо загубиш — усі токени протухнуть,");
  console.log("гравці просто перезайдуть (refresh-кука теж стане недійсною).");
}

// Тека keys/ ігнорується гітом власним .gitignore, а не кореневим: так
// правило їде разом із текою й не губиться при копіюванні репозиторію.
function ensureKeysDir() {
  if (!existsSync(KEYS)) mkdirSync(KEYS, { recursive: true });
  const ignore = path.join(KEYS, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, "# Приватні ключі. У git не їде нічого, крім цього файла.\n*\n!.gitignore\n!README.md\n");
  }
  const readme = path.join(KEYS, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(readme, [
      "# keys/",
      "",
      "Приватні ключі доступу. Тека **не** в git — і не має там опинитись.",
      "",
      "| Файл | Що це |",
      "|---|---|",
      "| `extrovert_ed25519` | ключ до малини на точці й до дроплетів |",
      "| `extrovert_ed25519.pub` | публічна частина: її кладуть у `authorized_keys` |",
      "",
      "Створити або переглянути: `bun scripts/keys.mjs ssh`.",
      "",
      "Ключ без пароля — навмисно: ним ходить автоматика (деплой, апдейтер),",
      "а пароль довелося б тримати поруч, що нічого не захищає. Захист тут —",
      "у тому, що файл не покидає машину, і в тому, що на сервері дозволений",
      "лише вхід за ключем.",
      "",
    ].join("\n"));
  }
}

function ssh() {
  ensureKeysDir();
  const show = rest.includes("--show");

  if (!existsSync(SSH_KEY)) {
    if (show) { console.error("ключа ще немає — створи: bun scripts/keys.mjs ssh"); process.exit(1); }
    execFileSync("ssh-keygen", [
      "-t", "ed25519",
      "-f", SSH_KEY,
      "-N", "",                                   // без пароля: ним ходить автоматика
      "-C", "extrovert.cafe deploy key",
    ], { stdio: "inherit" });
    try { chmodSync(SSH_KEY, 0o600); } catch { /* на NTFS права інші, це не біда */ }
    console.log("");
  } else {
    console.log(`ключ уже є: ${path.relative(ROOT, SSH_KEY)}\n`);
  }

  const pub = readFileSync(`${SSH_KEY}.pub`, "utf8").trim();
  console.log("Публічний ключ (його й треба покласти на сервер і на малину):\n");
  console.log(pub);
  console.log("\nКуди саме:");
  console.log("  • дроплети: поле SSH keys при створенні або ~/.ssh/authorized_keys");
  console.log("  • малина:   /home/pi/.ssh/authorized_keys");
  console.log("  • перевірити: ssh -i keys/extrovert_ed25519 root@<ip>");
}

const commands = { jwt, ssh };
if (!commands[command]) {
  console.error("команди: jwt | ssh [--show]");
  process.exit(1);
}
commands[command]();
