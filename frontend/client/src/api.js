// Тонкий клієнт до api. Access-токен живе в памʼяті й у localStorage, а
// refresh — httpOnly-кука, яку ставить сервер (docs/services.md §3).
// Токен короткий (15 хв), тож 401 — це нормальна подія, а не помилка:
// один раз міняємо куку на новий токен і повторюємо запит.
//
// Вихід з акаунта — лише тоді, коли сервер сказав «сесії немає» (401 на
// refresh). Обрив мережі чи api, що перезапускається під час деплою, — не
// привід викидати людину: токен і кука лишаються, запит просто падає.
const BASE = import.meta.env.VITE_API ?? "/api/v1";
const TOKEN_KEY = "extrovert.token";

let token = localStorage.getItem(TOKEN_KEY) || null;
let refreshing = null;              // спільна обіцянка: паралельні 401 чекають одну

export const getToken = () => token;
export function setToken(next) {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

// Токен, придатний просто зараз. Потрібен там, де 401 не допоможе: ws
// перевіряє токен один раз, під час рукостискання, і протухлий просто
// відхиляє — повторити запит, як це робить request(), там нікому.
// Тридцять секунд запасу: рівно стільки може зайняти саме зʼєднання.
export async function ensureToken() {
  const claims = token && (() => {
    try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch { return null; }
  })();
  if (token && (!claims?.exp || claims.exp > Date.now() / 1000 + 30)) return token;
  try {
    await refresh();
  } catch {
    return null;
  }
  return token;
}

export class ApiError extends Error {
  constructor(status, body, offline = false) {
    super(offline ? "Немає звʼязку" : body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    /* Запит не дійшов узагалі: мережі немає, api перезапускається, або
     * браузер відхилив його ще на preflight. Для екрана це не «помилка
     * операції», а «спробуй ще раз» — і каже це один тост на весь
     * застосунок, а не текст у тому місці, де натиснули (24.09.2026). */
    this.offline = offline;
  }
}

// Текст помилки для екрана. null — коли показувати нічого не треба: про
// обрив звʼязку вже сказав тост, і дублювати його блоком у пів-екрана
// означало б двічі лякати тим самим.
export const errText = (e) => (e?.offline ? null : e?.body?.error ?? e?.message ?? null);

async function refresh() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .catch(() => {
      // Той самий обрив, що й у send(): без цього TypeError із fetch
      // долітав до екрана повз ApiError.
      window.dispatchEvent(new CustomEvent("extrovert:offline"));
      throw new ApiError(0, null, true);
    })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const data = await res.json();
      setToken(data.token);
      return data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function send(path, { method, body, auth }) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth && token) headers.authorization = `Bearer ${token}`;
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch кидає TypeError і на вимкнений Wi-Fi, і на api, що
    // перезапускається, і на відхилений preflight — розрізнити їх із
    // браузера не можна, та й не треба: для людини це одне й те саме.
    // Раніше цей TypeError доходив до екрана як є, і в підказці під
    // кнопкою світилось «Failed to fetch» (24.09.2026).
    window.dispatchEvent(new CustomEvent("extrovert:offline"));
    throw new ApiError(0, null, true);
  }
}

async function request(path, { method = "GET", body, auth = true, retry = true } = {}) {
  let res = await send(path, { method, body, auth });

  if (res.status === 401 && auth && retry) {
    try {
      await refresh();
      res = await send(path, { method, body, auth });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      setToken(null);
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path) => request(path, { method: "DELETE" }),

  // Лист із посиланням для входу; next — куди повернутись після входу.
  emailLogin: (email, next) => request("/auth/email", { method: "POST", body: { email, next }, auth: false }),

  // Посилання з листа відкрите: токен із фрагмента міняємо на сесію.
  emailVerify: (token) =>
    request("/auth/email/verify", { method: "POST", body: { token }, auth: false }).then((r) => {
      setToken(r.token);
      return r;
    }),

  // Девелоперський вхід одним запитом. Лише в dev-збірці: у прод-бандл Vite
  // цю гілку не кладе зовсім, а api в проді такого роуту не має (env.js).
  devLogin: import.meta.env.DEV
    ? (nickname) =>
        request("/auth/dev", { method: "POST", body: { nickname }, auth: false }).then((r) => {
          setToken(r.token);
          return r.user;
        })
    : null,

  // Вхід через Google — не fetch, а перехід: Google має показати свій
  // екран і повернути людину назад на api, який поставить куку.
  googleLoginUrl: (next = "/") => `${BASE}/auth/google?next=${encodeURIComponent(next)}`,
  logout: () => request("/auth/logout", { method: "POST", auth: false }).finally(() => setToken(null)),

  // Спроба підняти сесію без екрана входу: якщо кука жива, застосунок
  // відкриється одразу.
  restore: () => refresh().then((r) => r.user),
};
