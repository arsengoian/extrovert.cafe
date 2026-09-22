// Обгортка над terraform: підставляє токени з .env (DigitalOcean і
// Cloudflare) і працює з infra/terraform, звідки б її не запустили.
//
//   bun scripts/tf.mjs plan
//   bun scripts/tf.mjs apply
//   bun scripts/tf.mjs output
//
// Навіщо обгортка: токен лежить у .env як DIGITALOCEAN_API_KEY, а
// terraform читає TF_VAR_do_token. Робити це руками щоразу — спосіб колись
// запустити apply без токена й довго дивитись на дивну помилку.
//
// Токен нікуди не друкується: ані в лог, ані в аргументи процесу.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "infra", "terraform");

const token = process.env.DIGITALOCEAN_API_KEY || process.env.DIGITALOCEAN_TOKEN;
if (!token) {
  console.error("✗ немає DIGITALOCEAN_API_KEY у .env — без нього terraform нічого не зробить");
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("команди: init | plan | apply | destroy | output | fmt | validate");
  process.exit(1);
}

// init окремо викликати не треба: якщо теки .terraform ще немає, робимо це
// самі — забутий init інакше дає помилку, яка ні про що не каже.
if (!existsSync(path.join(DIR, ".terraform")) && args[0] !== "init") {
  const init = spawnSync("terraform", ["init", "-input=false"], { cwd: DIR, stdio: "inherit", shell: true });
  if (init.status !== 0) process.exit(init.status ?? 1);
}

// tf.mjs ssh [команда] — зайти на публічний дроплет. Адресу питаємо в
// terraform, щоб вона не жила ще й у Makefile: там вона застаріє першою.
// Порт 2222, бо з частини мереж вихідний 22 закритий (docs/deploy.md §2.1).
if (args[0] === "ssh") {
  const env = { ...process.env, TF_VAR_do_token: token, DIGITALOCEAN_TOKEN: token };
  const ip = spawnSync("terraform", ["output", "-raw", "ip"], { cwd: DIR, shell: true, env, encoding: "utf8" });
  const host = (ip.stdout || "").trim();
  if (!host) {
    console.error("✗ terraform не знає адреси дроплета — спершу apply");
    process.exit(1);
  }
  // Шлях до ключа в лапках: у теці проекту є пробіл, і без них ssh бачить
  // два аргументи замість одного.
  const key = path.join(ROOT, "keys", "extrovert_ed25519");
  // Віддалена команда їде одним аргументом у лапках: локальна оболонка
  // лапки вже зняла, і без цього крапка з комою чи пайп дістаються не
  // серверу, а половині команди.
  const remote = args.slice(1).join(" ");
  const quoted = remote ? ` "${remote.replaceAll(String.fromCharCode(34), String.fromCharCode(92, 34))}"` : "";
  const cmd = `ssh -i "${key}" -p 2222 root@${host}${quoted}`;
  const ssh = spawnSync(cmd, { stdio: "inherit", shell: true });
  process.exit(ssh.status ?? 1);
}

const res = spawnSync("terraform", args, {
  cwd: DIR,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    TF_VAR_do_token: token,
    DIGITALOCEAN_TOKEN: token,
    // Cloudflare: DNS, R2, домени воркерів (infra/terraform/cloudflare.tf).
    TF_VAR_cloudflare_api_token: process.env.CLOUDFLARE_API_TOKEN ?? "",
    TF_VAR_cloudflare_account_id: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    // Кольори в логах Claude Code читаються гірше, ніж без них.
    TF_CLI_ARGS: process.env.TF_CLI_ARGS ?? "",
  },
});
process.exit(res.status ?? 1);
