// Клієнт до api. Той самий підхід, що в застосунку гравця: короткий токен
// у памʼяті й localStorage, refresh — httpOnly-кука на api.extrovert.cafe
// (тут вона своя, `asid`, щоб не перетинатися з сесією гравця).
import { breadcrumb, normalizePath } from "./errors.js";

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

// Свіжий токен для вебсокета: у заголовку його не передати, тож він їде
// підпротоколом — і мусить бути дійсним саме на момент рукостискання.
export async function ensureToken() {
  if (token) return token;
  try { await refresh(); } catch { return null; }
  return token;
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
  breadcrumb("fetch", `${opts.method ?? "GET"} ${normalizePath(path)} → ${res.status}`);
  // Не JSON — це сторінка помилки проксі (502 від Caddy чи Cloudflare під
  // час викочування). Раніше SyntaxError з JSON.parse летів до екрана
  // замість зрозумілого «HTTP 502».
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* лишаємо null */ }
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

  overview: () => request("/admin/overview"),
  health: (range) => request(`/admin/health${qs({ range })}`),
  server: (range) => request(`/admin/server${qs({ range })}`),
  point: (id, range) => request(`/admin/points/${encodeURIComponent(id)}${qs({ range })}`),
  // Сирі проби точки окремо по джерелу й сторінками (admin-ops.js, 16.10.2026).
  pointSamples: (id, p) => request(`/admin/points/${encodeURIComponent(id)}/samples${qs(p)}`),
  pointVideoUpload: (id, paused) => request(`/admin/points/${encodeURIComponent(id)}/video-upload`, { method: "POST", body: { paused } }),
  stats: (p) => request(`/admin/stats${qs(p)}`),
  analytics: (days, part) => request(`/admin/analytics${qs({ days, part })}`),
  broadcasts: (p) => request(`/admin/broadcasts${qs(p)}`),
  broadcastSend: (body) => request("/admin/broadcasts", { method: "POST", body }),
  quizzes: (p) => request(`/admin/quizzes${qs(p)}`),
  quizResponses: (p) => request(`/admin/quiz-responses${qs(p)}`),
  prices: () => request("/admin/prices"),
  promos: () => request("/admin/promos"),
  promoAdd: (body) => request("/admin/promos", { method: "POST", body }),
  promoSave: (id, body) => request(`/admin/promos/${id}`, { method: "PATCH", body }),
  promoArchive: (id) => request(`/admin/promos/${id}`, { method: "DELETE" }),
  promoSetCurrent: (id) => request(`/admin/promos/${id}/current`, { method: "POST" }),
  savePrices: (drinks) => request("/admin/prices", { method: "PATCH", body: { drinks } }),
  deployments: (p) => request(`/admin/deployments${qs(p)}`),
  deployMenu: (body) => request("/admin/menu/deployments", { method: "POST", body }),
  discountTest: (body) => request("/admin/menu/discount-test", { method: "POST", body }),
  problems: (p) => request(`/admin/problems${qs(p)}`),
  problemStatus: (id, status) => request(`/admin/problems/${id}`, { method: "PATCH", body: { status } }),
  // Фото лежить у приватному бакеті: спершу беремо підписане посилання,
  // потім браузер іде в R2 сам.
  problemPhoto: (id, n, download) => request(`/admin/problems/${id}/photo?n=${n}${download ? "&download=1" : ""}`),
  orders: (p) => request(`/admin/orders${qs(p)}`),
  order: (id) => request(`/admin/orders/${id}`),
  orderStatus: (id, body) => request(`/admin/orders/${id}/status`, { method: "POST", body }),
  users: (p) => request(`/admin/users${qs(p)}`),
  user: (id) => request(`/admin/users/${id}`),
  userStats: (id, excluded) => request(`/admin/users/${id}/stats`, { method: "POST", body: { excluded } }),
  // Покупки: кожен чек із бонусом і відео, невдалі спроби, продажі й гроші
  // (api/src/routes/admin-sales.js, 18.10.2026).
  receipts: (p) => request(`/admin/receipts${qs(p)}`),
  receiptAttempts: (p) => request(`/admin/receipts/attempts${qs(p)}`),
  sales: (p) => request(`/admin/sales${qs(p)}`),
  finance: (p) => request(`/admin/finance${qs(p)}`),
  // Облік залишків (api/src/routes/admin-stock.js, 18.10.2026).
  stock: () => request("/admin/stock"),
  stockHistory: (item, days) => request(`/admin/stock/history${qs({ item, days })}`),
  stockCounts: (p) => request(`/admin/stock/counts${qs(p)}`),
  stockCount: (id, x) => request(`/admin/stock/counts/${id}${qs({ x })}`),
  stockCountSave: (id, body) => request(id ? `/admin/stock/counts/${id}` : "/admin/stock/counts", { method: id ? "PUT" : "POST", body }),
  stockCountDelete: (id) => request(`/admin/stock/counts/${id}`, { method: "DELETE" }),
  stockPurchases: (p) => request(`/admin/stock/purchases${qs(p)}`),
  stockPurchase: (id) => request(`/admin/stock/purchases/${id}`),
  stockPurchaseSave: (id, body) => request(id ? `/admin/stock/purchases/${id}` : "/admin/stock/purchases", { method: id ? "PUT" : "POST", body }),
  stockPurchaseDelete: (id) => request(`/admin/stock/purchases/${id}`, { method: "DELETE" }),
  stockItems: () => request("/admin/stock/items"),
  stockItemSave: (id, body) => request(id ? `/admin/stock/items/${id}` : "/admin/stock/items", { method: id ? "PATCH" : "POST", body }),
  stockRecipes: (version) => request(`/admin/stock/recipes${qs({ version })}`),
  stockRecipeSave: (body) => request("/admin/stock/recipes", { method: "POST", body }),
  stockRecipeImport: (body) => request("/admin/stock/recipes/import", { method: "POST", body }),
  stockRecipeDelete: (id) => request(`/admin/stock/recipes/${id}`, { method: "DELETE" }),
  video: (p) => request(`/admin/video${qs(p)}`),
  // Сегмент лежить у приватному бакеті: беремо підписане посилання на 10 хв.
  videoDownload: (id) => request(`/admin/video/segments/${id}/download`),
  // Те саме для плеєра: без attachment і на годину, щоб перемотування не впиралось у термін.
  videoPlay: (id) => request(`/admin/video/segments/${id}/play`),
  // Доказ події з приватного extrovert-evidence: name — ключ у video_events.evidence.
  evidence: (id, name, download = false) =>
    request(`/admin/video/events/${id}/evidence/${name}${download ? "?download=1" : ""}`),
  // Смужка вирізок проходу: i — номер шматка проходу (по одному на сегмент).
  passageCrops: (id, i = 0) => request(`/admin/video/passages/${id}/crops/${i}`),
  supportThreads: (status, page) => request(`/admin/support/threads` + qs({ status, page })),
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
