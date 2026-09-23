// sync-prices.mjs — ціни з таблиці `drinks` → каталог товарів Checkbox.
//
//   bun scripts/sync-prices.mjs                  # показати різницю
//   bun scripts/sync-prices.mjs --apply          # записати ціни
//   bun scripts/sync-prices.mjs --prod [--apply] # увійти справжнім касиром
//   bun scripts/sync-prices.mjs --apply --create # ще й завести відсутні
//
// ⚠️ `--apply` міняє СПРАВЖНІ ціни, яким би касиром ми не входили. Каталог
// належить організації, а не касиру: тестовий касир бачить ті самі товари
// з тими самими цінами, що й справжній (перевірено 15.09.2026). Тестовий
// логін тут береться за замовчуванням не для ізоляції каталогу, а щоб
// справжній логін не світився там, де без нього можна обійтись. `--prod`
// потрібен, лише якщо тестовому касиру заборонено правити товари.
//
// Що змінилось 15.09.2026 і чому:
// - Один домен. Усі методи, включно з товарами, на api.checkbox.ua;
//   розділення на .in.ua (ПРРО) і .ua (товари) було помилкою дослідження.
// - Одна авторизація. Логін і пароль касира → JWT, який тримаємо лише в
//   памʼяті процесу й перевипускаємо, коли прилетів 401, а не за таймером.
//   Окремого «кабінетного токена» для товарів не існує.
// - Точкове оновлення замість імпорту всього каталогу файлом. Специфікація
//   на .ua (2.106.6) має PUT /api/v1/goods/{id}, у EditGoodsPayload немає
//   обовʼязкових полів — тож PUT з одним `price` мав би не чіпати решту.
//   «Мав би» не перевірено: запис у живий каталог без потреби не робили.
//   Тому після кожного PUT товар перечитується, і якщо разом із ціною
//   змінилось щось іще, скрипт зупиняється на першому ж товарі.
// - GET /api/v1/goods/by-code/{code} є в специфікації, але відповідає 404
//   «Облік товарів: Resource not found» навіть для товарів зі списку —
//   схоже, він лише для ввімкненого модуля обліку. Беремо загальний список.
//
// Ціни в Checkbox — цілі КОПІЙКИ (Еспресо 35 ₴ приходить як 3500), у базі —
// гривні. Переплутати одиниці означає продати каву за 35 копійок, тому
// нижче стоїть запобіжник на підозрілу різницю в ціні.
//
// Джерело цін — таблиця `drinks` (21.09.2026). Раніше читався
// pos/data/prices.json, і той самий каталог жив у двох місцях: база знала
// монети, файл — ціну, а каса могла не знати ні того, ні того.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@extrovert/lib/db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
// Створення товару — окремий дозвіл: ціну можна виправити, а зайвий
// товар у каталозі прибирають руками в кабінеті.
const CREATE = process.argv.includes("--create");

// ── конфіг: .env у корені монорепо, змінні оточення мають пріоритет ─────────
function loadEnv() {
  const file = path.join(HERE, "..", "..", ".env");
  let fromFile = {};
  try {
    // Той самий розбір, що в pos/scripts/push-prices.mjs. Коментарі — лише
    // цілими рядками: « #» усередині значення може бути частиною пароля.
    fromFile = Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    // .env немає — покладаємось лише на змінні оточення (docker, CI)
  }
  return { ...fromFile, ...process.env };
}

const env = loadEnv();
const PKG = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
const CLIENT = { "X-Client-Name": "extrovert-pos", "X-Client-Version": PKG.version };

let API = (env.CHECKBOX_API || "https://api.checkbox.ua").replace(/\/+$/, "");
if (/checkbox\.in\.ua/.test(API)) {
  console.warn(`УВАГА: CHECKBOX_API=${API} — старий домен. Усі методи на api.checkbox.ua, беру його; виправте .env.`);
  API = "https://api.checkbox.ua";
}

const LOGIN = PROD ? env.CHECKBOX_LOGIN : env.CHECKBOX_TEST_LOGIN;
const PASSWORD = PROD ? env.CHECKBOX_PASSWORD : env.CHECKBOX_TEST_PASSWORD;

if (!LOGIN || !PASSWORD) {
  const keys = PROD ? "CHECKBOX_LOGIN / CHECKBOX_PASSWORD" : "CHECKBOX_TEST_LOGIN / CHECKBOX_TEST_PASSWORD";
  console.error(`Не задано ${keys} — дивись .env.example`);
  process.exit(1);
}

// ── HTTP з токеном у памʼяті ─────────────────────────────────────────────────
let token = null;

async function signIn() {
  const res = await fetch(`${API}/api/v1/cashier/signin`, {
    method: "POST",
    headers: { ...CLIENT, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.access_token) {
    // Пароль у повідомлення не потрапляє ніколи — лише статус і пояснення API.
    throw new Error(`вхід касира не вдався: HTTP ${res.status} ${explain(body)}`);
  }
  return body.access_token;
}

async function call(method, urlPath, json) {
  for (let attempt = 0; ; attempt++) {
    if (!token) token = await signIn();
    const res = await fetch(`${API}${urlPath}`, {
      method,
      headers: {
        ...CLIENT,
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(json ? { "content-type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
    });
    // Токен протух — перевипускаємо рівно один раз. Другий 401 поспіль
    // означає не протухлий токен, а проблему з правами: повторювати марно.
    if (res.status === 401 && attempt === 0) { token = null; continue; }
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }
}

// Checkbox пояснює помилки то в `message`, то в `detail` (422 від валідації).
const explain = (body) => JSON.stringify(body?.message ?? body?.detail ?? body ?? "");

const uahToKop = (uah) => Math.round(Number(uah) * 100);
const kopToUah = (kop) => (kop / 100).toFixed(2);

// Поля, які PUT з одним `price` не має права зачепити.
const KEEP = ["name", "short_name", "code", "type", "barcode", "uktzed", "is_weight", "group_id", "parent"];
const drift = (before, after) => {
  const changed = KEEP.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
  const taxes = (g) => JSON.stringify((g.taxes ?? []).map((t) => t.code).sort());
  if (taxes(before) !== taxes(after)) changed.push("taxes");
  return changed;
};

// Увесь каталог сторінками → Map(code → товар). Код, що трапився двічі,
// позначаємо null: PUT не знатиме, котрий із двох товарів правити.
async function fetchCatalog() {
  const LIMIT = 100, byCode = new Map();
  for (let offset = 0; offset < 10_000; offset += LIMIT) {
    const r = await call("GET", `/api/v1/goods?limit=${LIMIT}&offset=${offset}`);
    if (r.status !== 200) throw new Error(`список товарів: HTTP ${r.status} ${explain(r.body)}`);
    const rows = r.body?.results ?? [];
    for (const g of rows) if (g.code) byCode.set(g.code, byCode.has(g.code) ? null : g);
    if (rows.length < LIMIT) return byCode;
  }
  throw new Error("список товарів не закінчується — API ігнорує offset?");
}

// ── основне ─────────────────────────────────────────────────────────────────
async function main() {
  // active = false лишає напій у базі, але з каталогу каси він не зникає
  // сам — тому звіряємо лише те, що справді продається.
  // Усі напої з кодом, а не лише активні: у каталозі каси має бути те, що
  // вміє продати машина. «Вимкнений» — це «не показуємо на екрані кіоска»,
  // а не «такого товару в касі немає»: якщо позиція лишилась у машині, чек
  // на неї все одно прийде, і без товару в каталозі він не зійдеться.
  const { rows: drinks } = await pool.query(
    "select system_code, name, price_uah, active from drinks order by sort_order, name"
  );
  if (!drinks.length) throw new Error("у базі немає напоїв — звіряти нема з чим");

  // Хто ми насправді. Змінні в .env легко переплутати місцями, а Checkbox
  // сам знає, тестовий це касир чи ні, — довіряємо йому, а не назві змінної.
  const me = await call("GET", "/api/v1/cashier/me");
  if (me.status !== 200) throw new Error(`cashier/me: HTTP ${me.status} ${explain(me.body)}`);
  if (me.body.is_test !== !PROD) {
    throw new Error(PROD
      ? "--prod, але CHECKBOX_LOGIN належить тестовому касиру (is_test=true) — перевірте .env"
      : "CHECKBOX_TEST_LOGIN належить СПРАВЖНЬОМУ касиру (is_test=false) — перевірте .env");
  }
  const org = me.body.organization?.title ?? "?";
  console.log(`${API} · ${PROD ? "справжній" : "тестовий"} касир · «${org}» · ${APPLY ? "ЗАПИС у живий каталог" : "лише показати різницю"}`);

  const catalog = await fetchCatalog();
  // Група й податки — з уже наявного товару: своїх довідників у нас немає,
  // а новий товар без групи стане в касі окремо від решти.
  const sample = [...catalog.values()].find(Boolean) ?? null;
  const changes = [], same = [], missing = [], noCode = [], suspicious = [], branchPriced = [];
  for (const d of drinks) {
    if (!d.system_code) { noCode.push(d.name); continue; }
    const good = catalog.get(d.system_code);
    if (good === undefined) {
      missing.push({ name: d.name, code: d.system_code, price: uahToKop(Number(d.price_uah)), active: d.active });
      continue;
    }
    if (good === null) { suspicious.push(`${d.name} (${d.system_code}): код трапляється в каталозі кілька разів, не чіпаю`); continue; }

    const from = good.price, to = uahToKop(Number(d.price_uah));
    // PUT міняє базову ціну товару. Якщо у філії своя ціна, каса продаватиме
    // за нею — «оновлено» було б неправдою, тому таке лише показуємо.
    const branch = (good.branches_info ?? []).filter((b) => Number.isInteger(b.price) && b.price !== to);
    if (branch.length) branchPriced.push(`${d.name} (${d.system_code}): ${branch.map((b) => kopToUah(b.price)).join(", ")} ₴`);
    if (from === to) { same.push(d.name); continue; }
    // Реальні зміни цін — десятки відсотків. Різниця в рази майже напевно
    // означає, що хтось сплутав гривні з копійками (тут або в API).
    const ratio = from > 0 ? to / from : Infinity;
    if (!(ratio <= 5 && ratio >= 0.2)) {
      suspicious.push(`${d.name} (${d.system_code}): ${from} → ${to} коп. — різниця ×${ratio.toFixed(1)}, не чіпаю`);
      continue;
    }
    changes.push({ name: d.name, code: d.system_code, id: good.id, from, to });
  }

  if (changes.length) {
    console.log(`\nЗмінилось ${changes.length}:`);
    for (const c of changes) console.log(`  ${c.name} (${c.code}): ${kopToUah(c.from)} → ${kopToUah(c.to)} ₴`);
  } else if (same.length) {
    console.log(`\nРізниці немає: ${same.length} цін уже збігаються з каталогом напоїв`);
  }
  if (changes.length && same.length) console.log(`Без змін: ${same.length}`);
  if (noCode.length) console.log(`Без system_code (пропущено): ${noCode.join(", ")}`);
  // Створювати товари скрипт не вміє й не повинен: новий товар — це ще
  // група й податки, які заводяться в кабінеті, а не з меню кіоску.
  if (missing.length) {
    const list = missing.map((m) => `${m.name} (${m.code}, ${kopToUah(m.price)} ₴)`).join(", ");
    console.log(CREATE ? `Заведемо в каталозі: ${list}` : `Нема в каталозі (--create заведе): ${list}`);
  }
  if (branchPriced.length) console.log(`Своя ціна у філії (базова її не перекриє, правити в кабінеті):\n  ${branchPriced.join("\n  ")}`);
  if (suspicious.length) console.log(`ПІДОЗРІЛО:\n  ${suspicious.join("\n  ")}`);

  const willCreate = CREATE ? missing : [];
  if (!APPLY || (!changes.length && !willCreate.length)) {
    if (!APPLY && (changes.length || willCreate.length)) {
      console.log(`\nЗаписати: додайте --apply. Це змінить каталог справжніх чеків «${org}».`);
    }
    return suspicious.length ? 1 : 0;
  }

  // Спершу заводимо відсутні: тоді нижче вже нема кому «не знайтись».
  for (const m of willCreate) {
    if (!sample) { console.log("  ✗ каталог порожній — нема звідки взяти групу для нового товару"); return 1; }
    const post = await call("POST", "/api/v1/goods", {
      code: m.code,
      name: m.name,
      price: m.price,
      type: sample.type ?? "good",
      is_weight: false,
      group_id: sample.group_id ?? null,
      taxes: (sample.taxes ?? []).map((t) => t.code),
    });
    if (post.status >= 300) {
      console.log(`  ✗ ${m.name} (${m.code}): POST HTTP ${post.status} ${explain(post.body)} — зупиняюсь`);
      return 1;
    }
    console.log(`  + ${m.name} (${m.code}): ${kopToUah(m.price)} ₴${m.active ? "" : " · у меню вимкнений"}`);
  }

  console.log("");
  for (const c of changes) {
    // Звіряємо перечитаний товар, а не лише статус PUT: 200 з іншою ціною
    // або зі скинутою групою — теж провал. Після першого провалу зупиняємось:
    // якщо PUT поводиться не так, як ми думаємо, решта каталогу вціліє.
    const before = await call("GET", `/api/v1/goods/${c.id}`);
    if (before.status !== 200) {
      console.log(`  ✗ ${c.name}: товар не читається (HTTP ${before.status} ${explain(before.body)}) — зупиняюсь`);
      return 1;
    }
    const put = await call("PUT", `/api/v1/goods/${c.id}`, { price: c.to });
    const after = await call("GET", `/api/v1/goods/${c.id}`);
    if (put.status !== 200 || after.body?.price !== c.to) {
      console.log(`  ✗ ${c.name}: PUT HTTP ${put.status} ${explain(put.body)} — зупиняюсь`);
      return 1;
    }
    const changed = drift(before.body, after.body);
    if (changed.length) {
      console.log(`  ✗ ${c.name}: ціну записано, але змінились і ${changed.join(", ")} — зупиняюсь, перевірте товар у кабінеті`);
      return 1;
    }
    console.log(`  ✓ ${c.name}: ${kopToUah(c.to)} ₴`);
  }
  console.log(`\nГотово: ${changes.length} цін оновлено${willCreate.length ? `, ${willCreate.length} товарів заведено` : ""}`);
  return suspicious.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => { console.error(e.message || e); process.exit(1); },
);
