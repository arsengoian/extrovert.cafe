// Вебсокет подій. Токен їде в Sec-WebSocket-Protocol, бо браузер не дає
// поставити Authorization на WebSocket (docs/services.md §3).
import { getToken } from "./api.js";

const URL_WS = import.meta.env.VITE_WS ?? `ws://${location.hostname}:3002/`;

export function connectEvents(onEvent) {
  let socket = null;
  let closed = false;
  let attempt = 0;

  const open = () => {
    const token = getToken();
    if (!token || closed) return;
    socket = new WebSocket(URL_WS, ["extrovert.v1", `jwt.${token}`]);

    socket.onopen = () => { attempt = 0; };
    socket.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* чужий формат — ігноруємо */ }
    };
    socket.onclose = () => {
      if (closed) return;
      // Обрив — не подія для користувача: мовчки перепідключаємось із
      // наростанням паузи, щоб не бити сервер після його падіння.
      attempt += 1;
      setTimeout(open, Math.min(1000 * 2 ** attempt, 30000));
    };
  };

  open();
  return () => { closed = true; socket?.close(); };
}
