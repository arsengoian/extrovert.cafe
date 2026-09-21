// Вебсокет подій. Токен їде в Sec-WebSocket-Protocol, бо браузер не дає
// поставити Authorization на WebSocket (docs/services.md §3).
//
// Перепідключення тут важливіше, ніж здається: сокет рветься не лише від
// поганої мережі, а й щоразу, коли викочується нова версія ws — тоді сервер
// сам шле 1001 «going away» (docs/deploy.md §2.3). Тому розрив — не подія
// для користувача, а звичайний стан, який має минати непомітно.
import { ensureToken, setToken } from "./api.js";

const URL_WS = import.meta.env.VITE_WS ?? `ws://${location.hostname}:3002/`;

const MAX_PAUSE_MS = 30_000;
// Після 1001 чекати нема чого: нова копія вже приймає зʼєднання. Невелика
// випадкова затримка потрібна лише щоб десяток телефонів не постукав у неї
// в одну мілісекунду.
const REDEPLOY_PAUSE_MS = 200;

export function connectEvents(onEvent) {
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const later = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(open, ms);
  };

  // Пауза з розкидом: усіх, кого розірвало одночасно (а при викочуванні це
  // саме так), інакше й повертає одночасно — рівно в ту секунду, коли нова
  // копія щойно піднялась.
  const backoff = () => {
    attempt += 1;
    const base = Math.min(1000 * 2 ** attempt, MAX_PAUSE_MS);
    return base * (0.5 + Math.random() / 2);
  };

  async function open() {
    if (closed) return;

    // Токен міг протухнути, поки сокет був відкритий: рукостискання з
    // протухлим дає 4401, і без оновлення клієнт крутив би відмову до
    // півхвилинної паузи, аж доки користувач сам щось не натисне.
    const token = await ensureToken();
    if (closed) return;
    if (!token) {
      // Не вийшло оновити — це або офлайн, або справді розлогінені.
      // Спробу однаково плануємо: мовчки померти гірше, ніж постукати ще раз.
      later(backoff());
      return;
    }

    socket = new WebSocket(URL_WS, ["extrovert.v1", `jwt.${token}`]);

    socket.onopen = () => { attempt = 0; };
    socket.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* чужий формат — ігноруємо */ }
    };
    socket.onclose = (e) => {
      if (closed) return;
      if (e.code === 4401) {
        // Сервер не прийняв токен. Викидаємо його, щоб наступна спроба
        // почалась з оновлення, а не з того самого відхиленого рядка.
        setToken(null);
        later(backoff());
        return;
      }
      if (e.code === 1001) {
        attempt = 0;
        later(REDEPLOY_PAUSE_MS + Math.random() * 300);
        return;
      }
      later(backoff());
    };
  }

  // Телефон присипляє вкладку, і сокет помирає разом із нею. Чекати після
  // повернення до пів хвилини немає сенсу — мережа вже є, а подій за цей час
  // могло накопичитись.
  const wake = () => {
    if (closed) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    attempt = 0;
    later(0);
  };
  const onVisible = () => { if (!document.hidden) wake(); };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", onVisible);

  open();

  return () => {
    closed = true;
    clearTimeout(timer);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", onVisible);
    socket?.close();
  };
}
