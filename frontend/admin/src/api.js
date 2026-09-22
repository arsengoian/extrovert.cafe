// Клієнт до api. Той самий підхід, що в застосунку гравця: короткий токен
// у памʼяті й localStorage, refresh — httpOnly-кука на api.extrovert.cafe
// (тут вона своя, `asid`, щоб не перетинатися з сесією гравця).
const BASE = import.meta.env.VITE_API ?? "/api/v1";
const TOKEN_KEY = "extrovert.admin.token";

let token = localStorage.getItem(TOKEN_KEY) || null;
let refreshing = null;

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

function refresh() {
  refreshing ??= fetch(`${BASE}/admin/refresh`, { method: "POST", credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const data = await res.json();
      setToken(data.token);
      return data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function send(path, { method = "GET", body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function request(path, opts = {}) {
  let res = await send(path, opts);
  if (res.status === 401 && opts.retry !== false) {
    try {
      await refresh();
      res = await send(path, opts);
    } catch (e) {
      // Скидаємо токен лише на справжнє «сесії немає»: обрив мережі не має
      // виглядати як вихід (той самий підхід, що в клієнті).
      if (e instanceof ApiError && e.status === 401) setToken(null);
      else throw e;
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

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return s.toString() ? `?${s}` : "";
};

export const api = {
  login: (email, password) =>
    request("/admin/login", { method: "POST", body: { email, password }, retry: false }).then((r) => { setToken(r.token); return r.admin; }),
  restore: () => refresh().then((r) => r.admin),
  logout: () => request("/admin/logout", { method: "POST" }).finally(() => setToken(null)),
  // Локальний вхід без пароля — лише там, де api його має (env.js).
  devLogin: import.meta.env.DEV
    ? () => request("/admin/dev-login", { method: "POST", retry: false }).then((r) => { setToken(r.token); return r.admin; })
    : null,

  overview: () => request("/admin/overview"),
  health: () => request("/admin/health"),
  point: (id) => request(`/admin/points/${encodeURIComponent(id)}`),
  stats: (p) => request(`/admin/stats${qs(p)}`),
  quizzes: (p) => request(`/admin/quizzes${qs(p)}`),
  quizResponses: () => request("/admin/quiz-responses"),
  prices: () => request("/admin/prices"),
  savePrices: (drinks) => request("/admin/prices", { method: "PATCH", body: { drinks } }),
  deployments: () => request("/admin/deployments"),
  deployMenu: (body) => request("/admin/menu/deployments", { method: "POST", body }),
  problems: (p) => request(`/admin/problems${qs(p)}`),
  problemStatus: (id, status) => request(`/admin/problems/${id}`, { method: "PATCH", body: { status } }),
  orders: (p) => request(`/admin/orders${qs(p)}`),
  order: (id) => request(`/admin/orders/${id}`),
  orderStatus: (id, body) => request(`/admin/orders/${id}/status`, { method: "POST", body }),
  users: (p) => request(`/admin/users${qs(p)}`),
  user: (id) => request(`/admin/users/${id}`),
  receipts: (p) => request(`/admin/receipts${qs(p)}`),
  video: (p) => request(`/admin/video${qs(p)}`),
  supportThreads: (status) => request(`/admin/support/threads` + qs({ status })),
  supportThread: (id) => request(`/admin/support/threads/${id}`),
  supportReply: (id, text) => request(`/admin/support/threads/${id}/reply`, { method: "POST", body: { text } }),
  supportStatus: (id, status) => request(`/admin/support/threads/${id}/status`, { method: "POST", body: { status } }),
  // Вкладення тягнемо самі: посилання без заголовка з токеном не працює.
  supportFile: async (fileId) => {
    const res = await fetch(`${BASE}/admin/support/files/${encodeURIComponent(fileId)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) throw new ApiError(res.status, null);
    return res.blob();
  },
};
