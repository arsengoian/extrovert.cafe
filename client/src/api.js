// Тонкий клієнт до api. Access-токен живе в памʼяті й у localStorage, а
// refresh — httpOnly-кука, яку ставить сервер (docs/services.md §3).
// Токен короткий (15 хв), тож 401 — це нормальна подія, а не помилка:
// один раз міняємо куку на новий токен і повторюємо запит.
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

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function refresh() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
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
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function request(path, { method = "GET", body, auth = true, retry = true } = {}) {
  let res = await send(path, { method, body, auth });

  if (res.status === 401 && auth && retry) {
    try {
      await refresh();
      res = await send(path, { method, body, auth });
    } catch {
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

  // Поки немає Google/Apple: вхід одним запитом, лише в local.
  devLogin: (nickname) =>
    request("/auth/dev", { method: "POST", body: { nickname }, auth: false }).then((r) => {
      setToken(r.token);
      return r.user;
    }),

  logout: () => request("/auth/logout", { method: "POST", auth: false }).finally(() => setToken(null)),

  // Спроба підняти сесію без екрана входу: якщо кука жива, застосунок
  // відкриється одразу.
  restore: () => refresh().then((r) => r.user),
};
