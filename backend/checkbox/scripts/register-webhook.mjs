// register-webhook.mjs — вебхук Checkbox на наш приймач (docs/checkbox.md,
// «Вебхук»).
//
//   bun scripts/register-webhook.mjs                 # стан: куди шле і чи падав
//   bun scripts/register-webhook.mjs --set           # зареєструвати (тестовий касир)
//   bun scripts/register-webhook.mjs --set --prod    # зареєструвати бойову касу
//   … --url https://…/webhook/checkbox               # інша адреса, ніж API_ORIGIN
//
// Checkbox у відповідь на реєстрацію видає key — секрет підпису. Він
// похідний, тому в .env його немає: скрипт кладе його в базу (webhook_keys),
// звідки його читає приймач. Ключ ніде не друкується.
//
// Вебхук налаштовується на касу, а не на організацію, тож крім логіна касира
// потрібен X-License-Key — ключ ліцензії каси з кабінету Checkbox.
import { pool } from "@extrovert/lib/db.js";

const PROD = process.argv.includes("--prod");
const SET = process.argv.includes("--set");
const urlArg = process.argv.indexOf("--url");
const API = (process.env.CHECKBOX_API || "https://api.checkbox.ua").replace(/\/+$/, "");

// Тестові дані паралельно зі справжніми — та сама пара, що й у sync-prices.
const LOGIN = PROD ? process.env.CHECKBOX_LOGIN : process.env.CHECKBOX_TEST_LOGIN;
const PASSWORD = PROD ? process.env.CHECKBOX_PASSWORD : process.env.CHECKBOX_TEST_PASSWORD;
const LICENSE = PROD ? process.env.CHECKBOX_LICENSE_KEY : process.env.CHECKBOX_TEST_LICENSE_KEY;
const URL = urlArg > 0
  ? process.argv[urlArg + 1]
  : `${(process.env.API_ORIGIN || "https://api.extrovert.cafe").replace(/\/$/, "")}/webhook/checkbox`;

const missing = [
  !LOGIN && (PROD ? "CHECKBOX_LOGIN" : "CHECKBOX_TEST_LOGIN"),
  !PASSWORD && (PROD ? "CHECKBOX_PASSWORD" : "CHECKBOX_TEST_PASSWORD"),
  !LICENSE && (PROD ? "CHECKBOX_LICENSE_KEY" : "CHECKBOX_TEST_LICENSE_KEY"),
].filter(Boolean);
if (missing.length) {
  console.error(`у .env бракує: ${missing.join(", ")}`);
  process.exit(1);
}

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}`, "x-license-key": LICENSE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${data.message ?? ""}`.trim());
  return data;
}

try {
  const { access_token: token } = await http("POST", "/api/v1/cashier/signin", { body: { login: LOGIN, password: PASSWORD } });
  const me = await http("GET", "/api/v1/cashier/me", { token });
  console.log(`касир: ${me.full_name ?? me.name ?? "?"}${me.is_test ? " (тестовий)" : ""}`);
  // Переплутати пари в .env найлегше — вірити назві змінної не можна.
  if (PROD && me.is_test) throw new Error("--prod, а касир тестовий — перевір CHECKBOX_LOGIN");
  if (!PROD && !me.is_test) throw new Error("без --prod, а касир бойовий — перевір CHECKBOX_TEST_LOGIN");

  if (SET) {
    const { key } = await http("POST", "/api/v1/webhook", { token, body: { url: URL } });
    if (!key) throw new Error("Checkbox не повернув key");
    await pool.query(
      `insert into webhook_keys (provider, key, url) values ('checkbox', $1, $2)
       on conflict (provider) do update set key = excluded.key, url = excluded.url, registered_at = now()`,
      [key, URL]
    );
    console.log(`зареєстровано: ${URL}; ключ підпису збережено в webhook_keys`);
  }

  const hook = await http("GET", "/api/v1/webhook", { token });
  console.log(`вебхук: ${hook.url ?? "(немає)"}`);
  if (hook.last_error_date) console.log(`остання помилка: ${hook.last_error_date} — ${hook.last_error_message ?? ""}`);
  const stored = await pool.query("select url, registered_at from webhook_keys where provider = 'checkbox'");
  console.log(stored.rows[0]
    ? `у базі: ключ для ${stored.rows[0].url} від ${new Date(stored.rows[0].registered_at).toISOString()}`
    : "у базі ключа немає — приймач відповідатиме 401, доки не буде --set");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
