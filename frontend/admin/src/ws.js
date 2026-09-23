// Вебсокет подій для адмінки. Потрібен рівно для одного: коли людина
// написала в підтримку, розмова має з'явитися на екрані сама, а не після
// того, як хтось натисне «Оновити».
//
// Канал у ws один на всіх адмінів («admin»): подія та сама, розділяти її
// по особах нема сенсу (backend/ws/src/index.js).
//
// Пере підключення влаштоване простіше, ніж у застосунку гравця: адмінка
// відкрита на десктопі, вкладку не присипляють, і телефонів у мережі не
// десятки — тому без розкиду пауз, лише зростаюча затримка.
import { ensureToken, setToken } from "./api.js";

const URL_WS = import.meta.env.VITE_WS ?? `ws://${location.hostname}:3002/`;
const MAX_PAUSE_MS = 30_000;

export function connectEvents(onEvent) {
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const later = (ms) => { clearTimeout(timer); timer = setTimeout(open, ms); };
  const backoff = () => Math.min(1000 * 2 ** ++attempt, MAX_PAUSE_MS);

  async function open() {
    if (closed) return;
    // Токен міг протухнути, поки сокет висів: рукостискання з протухлим
    // дає 4401, і без оновлення ми б стукали ним до самої паузи.
    const token = await ensureToken();
    if (closed) return;
    if (!token) { later(backoff()); return; }

    socket = new WebSocket(URL_WS, ["extrovert.v1", `jwt.${token}`]);
    socket.onopen = () => { attempt = 0; };
    socket.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* чужий формат — ігноруємо */ }
    };
    socket.onclose = (e) => {
      if (closed) return;
      if (e.code === 4401) { setToken(null); later(backoff()); return; }
      // 1001 — викочування нової версії ws: нова копія вже приймає.
      later(e.code === 1001 ? 300 : backoff());
    };
  }

  open();
  return () => { closed = true; clearTimeout(timer); socket?.close(); };
}
