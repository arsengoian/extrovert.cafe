// Тонкий клієнт до api. Токен адмінки живе в localStorage і не оновлюється
// сам: у нього 12 годин (backend/api/src/routes/admin.js), тобто одна зміна, а
// справжній вхід із сесією зʼявиться разом із першими екранами.
const BASE = import.meta.env.VITE_API ?? "/api/v1";
const TOKEN_KEY = "extrovert.admin.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Девелоперський вхід є лише поки api в local: у проді роут віддає 404, і
// кнопка просто не спрацює. Показуємо її тільки на локальній адресі, щоб
// не обіцяти того, чого немає.
export const devLoginPossible = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

async function request(path, { method = "GET", body, raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw && res.ok) return res.blob();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  overview: () => request("/admin/overview"),
  devLogin: async () => {
    const r = await request("/admin/dev-login", { method: "POST" });
    setToken(r.token);
    return r.admin;
  },
  logout: () => setToken(null),
  supportThreads: (status) => request(`/admin/support/threads${status ? `?status=${status}` : ""}`),
  supportThread: (id) => request(`/admin/support/threads/${id}`),
  supportReply: (id, text) => request(`/admin/support/threads/${id}/reply`, { method: "POST", body: { text } }),
  supportStatus: (id, status) => request(`/admin/support/threads/${id}/status`, { method: "POST", body: { status } }),
  supportFile: (fileId) => request(`/admin/support/files/${encodeURIComponent(fileId)}`, { raw: true }),
};
