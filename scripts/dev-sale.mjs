// Емуляція продажу: чек у Checkbox → вебхук → бонус → QR на кіоску.
//
//   bun scripts/dev-sale.mjs                       # перший активний напій, оплата карткою
//   bun scripts/dev-sale.mjs --drink a033 --pay cash
//   bun scripts/dev-sale.mjs --list                # які напої є в сідах
//
// Код напою — такий, як його бачить каса: літера машини плюс номер позиції
// («a033»). У сідах лежить лише номер, бо він на всіх машинах однаковий;
// літеру беремо з --drink, а без неї — «a» (перша машина).
//
// **Чек створює лише тестовий касир** (рішення власника 22.09.2026):
// фіскальний чек бойової каси — це подія в ДПС і рядок у звітності точки.
// Тому токен береться через cashierToken({ write: true }), який без
// CHECKBOX_TEST_* просто не видається, а перед продажем ще й питаємо
// cashier/me: is_test має бути true.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestCashier, cashierToken } from "../backend/checkbox/src/cashier.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = (process.env.CHECKBOX_API || "https://api.checkbox.ua").replace(/\/+$/, "");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const drinks = JSON.parse(readFileSync(path.join(ROOT, "db", "seeds", "drinks.json"), "utf8"));
const asked = flag("drink");
const letter = /^[a-z]/.test(asked ?? "") ? asked[0] : "a";
const slot = asked ? asked.replace(/^[a-z]/, "") : null;
if (args.includes("--list")) {
  for (const d of drinks.filter((x) => x.active)) console.log(`${letter}${d.slot}\t${d.name}\t${d.price_uah} ₴\tбонус ${d.coins}`);
  process.exit(0);
}

const drink = slot ? drinks.find((d) => d.slot === slot) : drinks.find((d) => d.active);
if (!drink) {
  console.error(asked ? `✗ немає напою з кодом ${asked} (--list покаже наявні)` : "✗ у сідах немає активних напоїв");
  process.exit(1);
}
const code = letter + drink.slot;
const kopecks = Math.round(Number(drink.price_uah) * 100);
const payment = (flag("pay") ?? "card") === "cash" ? "CASH" : "CASHLESS";

const token = await cashierToken({ write: true, log: { info: (m, x) => console.log(m, x ?? "") } });
if (!token) {
  console.error("✗ немає логіна тестового касира: CHECKBOX_TEST_LOGIN / CHECKBOX_TEST_PASSWORD");
  process.exit(1);
}
const me = await assertTestCashier(token);
console.log(`касир: ${me.full_name ?? me.id} (тестовий)`);

// X-License-Key — ключ самої каси: без нього Checkbox не відкриває зміну й
// не приймає чек (лише тестовий, CHECKBOX_TEST_LICENSE_KEY).
const LICENSE = process.env.CHECKBOX_TEST_LICENSE_KEY;
if (!LICENSE) {
  console.error("✗ немає CHECKBOX_TEST_LICENSE_KEY — це ключ тестової каси, без нього чек не створити");
  process.exit(1);
}

const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "X-License-Key": LICENSE, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return data;
};

// Зміна: чек без відкритої зміни Checkbox не приймає.
let shift = await call("GET", "/api/v1/cashier/shift").catch(() => null);

// …але й зі старою не приймає: понад добу відкрита зміна дає
// shift.opened_too_long, бо закон вимагає Z-звіт раз на добу. На бойовій
// касі зміну закриває касир наприкінці дня, а тестова висить рівно доти,
// доки хтось не згадає про неї, — тобто після вихідних продаж падає завжди.
// Закриваємо самі: Z-звіт тестової каси нікому нічого не коштує, а ручний
// крок посеред налагодження коштує уваги (26.09.2026, власник).
const shiftHours = (s) => (s?.opened_at ? (Date.now() - Date.parse(s.opened_at)) / 3600000 : 0);
if (shift?.status === "OPENED" && shiftHours(shift) >= 23) {
  console.log(`зміну відкрито ${shiftHours(shift).toFixed(1)} год тому — закриваю (Z-звіт) і відкриваю нову`);
  let closing = await call("POST", "/api/v1/shifts/close", {});
  for (let i = 0; i < 30 && closing.status !== "CLOSED"; i++) {
    await Bun.sleep(1000);
    closing = await call("GET", `/api/v1/shifts/${closing.id}`);
  }
  if (closing.status !== "CLOSED") throw new Error(`зміна не закрилась: ${closing.status}`);
  console.log(`зміна ${closing.serial ?? closing.id} закрита, Z-звіт ${closing.z_report?.serial ?? closing.z_report?.id ?? "—"}`);
  shift = null;
}

if (!shift || shift.status !== "OPENED") {
  console.log("відкриваємо зміну…");
  shift = await call("POST", "/api/v1/shifts", {});
  for (let i = 0; i < 30 && shift.status !== "OPENED"; i++) {
    await Bun.sleep(1000);
    shift = await call("GET", `/api/v1/shifts/${shift.id}`);
  }
  if (shift.status !== "OPENED") throw new Error(`зміна не відкрилась: ${shift.status}`);
}
console.log(`зміна: ${shift.serial ?? shift.id} (${shift.status})`);

// Продаж. Кількість у тисячних, суми в копійках — так вимагає Checkbox.
let receipt = await call("POST", "/api/v1/receipts/sell", {
  goods: [{ good: { code, name: drink.name, price: kopecks }, quantity: 1000 }],
  payments: [{ type: payment, value: kopecks, label: payment === "CASH" ? "Готівка" : "Картка" }],
});
console.log(`чек створений: ${receipt.id} (${receipt.status})`);

for (let i = 0; i < 40 && !["DONE", "SIGNED", "DELIVERED"].includes(receipt.status); i++) {
  await Bun.sleep(1500);
  receipt = await call("GET", `/api/v1/receipts/${receipt.id}`);
}
console.log(`\n✓ ${drink.name} за ${drink.price_uah} ₴ (${payment})`);
console.log(`  статус: ${receipt.status}`);
console.log(`  фіскальний номер: ${receipt.fiscal_code ?? "—"}`);
console.log(`  id: ${receipt.id}`);
if (receipt.tax_url) console.log(`  ДПС: ${receipt.tax_url}`);
console.log("\nДалі: вебхук → бонус → QR на кіоску (docs/services.md §4).");
