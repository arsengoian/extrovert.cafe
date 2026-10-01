// Каталог товарів Checkbox — ціни, які бачить каса точки. Ціль `checkbox`
// деплою (scheduler, jobs/menu.js) пише сюди ціну кожного напою точки й
// одразу перечитує товар: деплой «успішний» лише тоді, коли в каталозі
// справді та ціна, а решта полів товару не зрушила (власник, 01.10.2026).
// Ручний backend/checkbox/scripts/sync-prices.mjs робить те саме для всього
// каталогу разом і лишається інструментом звірки.
//
// Каталог належить організації, а не касиру: тестовий касир бачить і
// правити може ті самі товари, що й бойовий (docs/checkbox.md). Тому писати
// має право лише прод (APP_ENV=production) — локальний scheduler інакше
// міняв би ціни справжньої каси. Чеків тут не створюємо: лише довідник
// товарів, правило «бойовим касиром чеків не робимо» (checkbox/src/cashier.js)
// цього не стосується.
//
// Ціни в Checkbox — цілі КОПІЙКИ (еспресо 35 ₴ — це 3500), у нас — гривні.

// Поля, яких запис ціни не має права зачепити.
const KEEP = ["name", "short_name", "code", "type", "barcode", "uktzed", "is_weight", "group_id", "parent"];

export const uahToKop = (uah) => Math.round(Number(uah) * 100);

// Checkbox пояснює помилки то в `message`, то в `detail` (422 від валідації).
const explain = (body) => JSON.stringify(body?.message ?? body?.detail ?? body ?? "").slice(0, 200);

function drift(before, after) {
  const changed = KEEP.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
  const taxes = (g) => JSON.stringify((g.taxes ?? []).map((t) => t.code).sort());
  if (taxes(before) !== taxes(after)) changed.push("taxes");
  return changed;
}

// Філій Checkbox (branches_info) не використовуємо (власник, 01.10.2026):
// усі товари в одному каталозі, а точку розрізняє літера машини в коді
// товару — «a018», «b018». Тож ціна напою на точці — це просто ціна товару
// з її кодом.
export function catalogClient({ env = process.env } = {}) {
  const api = (env.CHECKBOX_API || "https://api.checkbox.ua").replace(/\/+$/, "");
  const prod = env.APP_ENV === "production";
  const login = prod ? env.CHECKBOX_LOGIN : env.CHECKBOX_TEST_LOGIN;
  const password = prod ? env.CHECKBOX_PASSWORD : env.CHECKBOX_TEST_PASSWORD;
  let token = null;

  async function signIn() {
    const res = await fetch(`${api}/api/v1/cashier/signin`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ login, password }),
    });
    const body = await res.json().catch(() => ({}));
    // Пароль у повідомлення не потрапляє — лише статус і пояснення API.
    if (res.status !== 200 || !body.access_token) throw new Error(`вхід касира: HTTP ${res.status} ${explain(body)}`);
    return body.access_token;
  }

  async function call(method, path, json) {
    for (let attempt = 0; ; attempt++) {
      if (!token) token = await signIn();
      const res = await fetch(`${api}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(json ? { "content-type": "application/json" } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
      });
      // Протух токен — перевипускаємо рівно раз; другий 401 — це права.
      if (res.status === 401 && attempt === 0) { token = null; continue; }
      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    }
  }

  // Увесь каталог → Map(code → товар). Код, що трапився двічі, — null:
  // невідомо, котрий із двох товарів правити.
  async function catalog() {
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

  // Записати ціну й перевірити. Повертає null, якщо в каталозі тепер саме
  // ця ціна, інакше — що не так.
  async function setPrice(good, kop) {
    const before = await call("GET", `/api/v1/goods/${good.id}`);
    if (before.status !== 200) return `товар не читається: HTTP ${before.status} ${explain(before.body)}`;
    const put = await call("PUT", `/api/v1/goods/${good.id}`, { price: kop });
    if (put.status !== 200) return `PUT: HTTP ${put.status} ${explain(put.body)}`;
    const after = await call("GET", `/api/v1/goods/${good.id}`);
    if (after.status !== 200) return `після запису товар не читається: HTTP ${after.status}`;
    const got = after.body?.price;
    if (got !== kop) return `записали ${kop} коп., а в каталозі ${got}`;
    const changed = drift(before.body, after.body);
    if (changed.length) return `ціну записано, але змінились і ${changed.join(", ")} — перевір товар у кабінеті`;
    return null;
  }

  return { prod, configured: Boolean(login && password), catalog, setPrice };
}
