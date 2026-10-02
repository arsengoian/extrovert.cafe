// Навігація застосунку — у власну аналітику (api: src/analytics.js,
// власник 02.10.2026). Кожна зміна екрана — подія { screen, from }; хто й
// звідки, сервер визначає сам. Запити до api він записує й без нас, тут —
// лише те, чого сервер не бачить: куди людина пішла.
//
// Пачкою раз на кілька секунд, а не запитом на кожен перехід, і обовʼязково
// при згортанні вкладки — інакше останні екрани сесії губились би.
// Тіло — text/plain, а токен — у самому тілі, не в заголовку: так запит
// «простий», без preflight, і його довозить і sendBeacon, і fetch keepalive
// навіть після закриття сторінки.
import { getToken } from "./api.js";

const BASE = import.meta.env.VITE_API ?? "/api/v1";
const FLUSH_MS = 5000;
const MAX_BATCH = 50;

const queue = [];
let last = null;
let timer = null;

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const now = Date.now();
  const events = queue.splice(0, MAX_BATCH).map(({ t, ...e }) => ({ ...e, ago: now - t }));
  const body = JSON.stringify({ token: getToken(), events });
  const url = `${BASE}/events`;
  try {
    if (document.visibilityState === "hidden" && navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) return;
    fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch { /* аналітика ніколи не ламає застосунок */ }
  if (queue.length) flush();
}

/** Людина опинилась на екрані screen. Той самий екран підряд — не подія. */
export function trackScreen(screen) {
  if (!screen || screen === last) return;
  queue.push({ type: "nav", screen, ...(last ? { from: last } : {}), t: Date.now() });
  last = screen;
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(flush, FLUSH_MS);
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
}
