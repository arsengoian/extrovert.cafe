// Тонкий клієнт до api. Токен живе в памʼяті + localStorage: refresh-кука
// зʼявиться разом зі справжнім входом (docs/services.md §3), поки що це
// девелоперський вхід.
const BASE = import.meta.env.VITE_API ?? "/api/v1";
const TOKEN_KEY = "extrovert.token";

let token = localStorage.getItem(TOKEN_KEY) || null;

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

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth && token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
};
