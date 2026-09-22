// Адміни адмінки: завести, поставити пароль, вимкнути, повернути, показати.
//
// Форми «зареєструватися» в адмінці немає й не буде: адміністратора заводить
// людина, яка вже має доступ до сервера (docs/services.md §3). Тому це
// скрипт усередині пакета api — на проді він запускається в контейнері:
//
//   docker compose exec api bun run admin list
//   docker compose exec api bun run admin add --email me@extrovert.cafe
//   docker compose exec api bun run admin password --email me@extrovert.cafe
//   docker compose exec api bun run admin disable --email me@extrovert.cafe
//   docker compose exec api bun run admin enable  --email me@extrovert.cafe
//
// Пароль можна передати через stdin (`--password-stdin`), інакше скрипт
// вигадає надійний і надрукує його рівно один раз: у базі лежить тільки
// scrypt-хеш, і відновити пароль звідти не вийде — лише поставити новий.
import { randomBytes } from "node:crypto";
import { pool, one } from "../src/db.js";
import { hashPassword } from "../src/admin-auth.js";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const email = (flag("email") || "").trim().toLowerCase();
const role = flag("role") || "owner";

async function readPassword() {
  if (!args.includes("--password-stdin")) {
    // Без розділювачів, які легко загубити при копіюванні.
    const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(20);
    return { value: [...bytes].map((b) => alphabet[b % alphabet.length]).join(""), generated: true };
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (value.length < 12) {
    console.error("✗ пароль коротший за 12 символів — адмінка має доступ до всіх даних гравців");
    process.exit(1);
  }
  return { value, generated: false };
}

const need = (what) => { if (!email) { console.error(`✗ потрібен --email (${what})`); process.exit(1); } };

const commands = {
  async list() {
    const { rows } = await pool.query(
      `select email, role, disabled_at, password_hash is not null as has_password, last_login_at from admin_users order by created_at`
    );
    if (!rows.length) return console.log("адмінів ще немає");
    for (const a of rows) {
      const state = a.disabled_at ? "вимкнений" : a.has_password ? "активний" : "без пароля";
      console.log(`${a.email.padEnd(32)} ${a.role.padEnd(6)} ${state.padEnd(11)} вхід: ${a.last_login_at ? new Date(a.last_login_at).toISOString().slice(0, 16).replace("T", " ") : "—"}`);
    }
  },

  async add() {
    need("кого заводимо");
    if (await one("select 1 from admin_users where email = $1", [email])) {
      console.error(`✗ ${email} уже є — пароль міняє команда password`);
      process.exit(1);
    }
    const password = await readPassword();
    const admin = await one(
      `insert into admin_users (email, role, password_hash, password_set_at)
       values ($1, $2, $3, now()) returning id, email, role`,
      [email, role, await hashPassword(password.value)]
    );
    console.log(`✓ ${admin.email} (${admin.role})`);
    if (password.generated) console.log(`  пароль: ${password.value}\n  Показано один раз — збережи в менеджері паролів.`);
  },

  async password() {
    need("кому міняємо пароль");
    const password = await readPassword();
    const admin = await one(
      `update admin_users set password_hash = $2, password_set_at = now() where email = $1 returning email`,
      [email, await hashPassword(password.value)]
    );
    if (!admin) { console.error(`✗ немає такого адміна: ${email}`); process.exit(1); }
    console.log(`✓ новий пароль для ${admin.email}`);
    if (password.generated) console.log(`  пароль: ${password.value}\n  Показано один раз.`);
  },

  async disable() {
    need("кого вимикаємо");
    const admin = await one("update admin_users set disabled_at = now() where email = $1 returning email", [email]);
    if (!admin) { console.error(`✗ немає такого адміна: ${email}`); process.exit(1); }
    console.log(`✓ ${admin.email} вимкнений: у сесію він більше не ввійде, а наявна згасне за 15 хвилин`);
  },

  async enable() {
    need("кого вмикаємо");
    const admin = await one("update admin_users set disabled_at = null where email = $1 returning email", [email]);
    if (!admin) { console.error(`✗ немає такого адміна: ${email}`); process.exit(1); }
    console.log(`✓ ${admin.email} знову має доступ`);
  },
};

if (!commands[command]) {
  console.error("команди: list | add | password | disable | enable   (--email, --role owner|ops, --password-stdin)");
  process.exit(1);
}
await commands[command]();
await pool.end();
