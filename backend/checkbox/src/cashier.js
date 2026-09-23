// Токен касира Checkbox і головне правило роботи з ним.
//
// **Чеків бойовим касиром ми не створюємо ніколи** (рішення власника
// 22.09.2026). Фіскальний чек — це податкова подія в ДПС, а не тестові
// дані: його не можна «прибрати після перевірки», і кожен такий чек
// підмішується у справжню звітність точки. Усе, що створює подію покупки
// (`dev-sale` та будь-що подібне), працює лише тестовим касиром, чиї чеки
// в ДПС не йдуть.
//
// Тому токен береться тут і тільки тут, а той, кому треба писати, просить
// його явно: cashierToken({ write: true }). Без тестових облікових даних
// такий виклик не повертає токен, а кидає помилку.
const API = () => process.env.CHECKBOX_API || "https://api.checkbox.ua";
const TOKEN_TTL_MS = 50 * 60_000;          // токен касира живе годину

// Тестові дані живуть паралельно зі справжніми. `test` тут означає не
// «схоже, ми не в проді», а «в руках справді тестовий касир»: якщо
// CHECKBOX_TEST_* порожні, ми беремо бойового — і чесно це визнаємо.
// Раніше прапорець брехав саме в цьому випадку.
export function creds(env = process.env) {
  const preferTest = env.NODE_ENV !== "production";
  if (preferTest && env.CHECKBOX_TEST_LOGIN && env.CHECKBOX_TEST_PASSWORD) {
    return { login: env.CHECKBOX_TEST_LOGIN, password: env.CHECKBOX_TEST_PASSWORD, test: true };
  }
  return { login: env.CHECKBOX_LOGIN, password: env.CHECKBOX_PASSWORD, test: false };
}

let token = null;
let tokenAt = 0;
let tokenTest = null;

// Кеш токена живе тут, тому й скидає його той, хто тут: poll.js колись
// писав token = null у себе й падав із «token is not defined» на кожному
// 401 від Checkbox (спіймано лінтером 23.09.2026).
export function resetCashierToken() {
  token = null;
  tokenAt = 0;
  tokenTest = null;
}

export async function cashierToken({ log, write = false, env = process.env } = {}) {
  const { login, password, test } = creds(env);
  if (write && !test) {
    throw new Error(
      "чек створюється лише тестовим касиром: постав CHECKBOX_TEST_LOGIN і CHECKBOX_TEST_PASSWORD. " +
      "Бойовим касиром ми подій покупки не створюємо — це чек у ДПС і рядок у звітності точки"
    );
  }
  if (!login || !password) return null;
  if (token && tokenTest === test && Date.now() - tokenAt < TOKEN_TTL_MS) return token;

  const res = await fetch(`${API()}/api/v1/cashier/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) throw new Error(`signin: HTTP ${res.status}`);
  const data = await res.json();
  token = data.access_token;
  tokenAt = Date.now();
  tokenTest = test;
  log?.info("токен касира отримано", { test });
  return token;
}

// Друга лінія: перед записом питаємо самого Checkbox, чи касир тестовий —
// логін міг вести куди завгодно (docs/checkbox.md §«Тестовий касир»).
export async function assertTestCashier(auth) {
  const res = await fetch(`${API()}/api/v1/cashier/me`, { headers: { authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`cashier/me: HTTP ${res.status}`);
  const me = await res.json();
  if (!me.is_test) throw new Error("cashier/me каже is_test: false — бойовим касиром чеки не створюємо");
  return me;
}
