// Звідки людина прийшла: ?p=<точка> у QR (docs/urls.md, «Куди дівається p»).
//
//   qr.extrovert.cafe?p=1        → /?p=1           — наклейка на автоматі;
//   /b/<токен>?p=kyiv-01         → бонус за чек     — QR на екрані кіоска.
//
// Скан рахуємо тут, коли застосунок уже відкрився, а не у воркері qr.*: туди
// ж кожні дві хвилини ходить перевірка здоровʼя overseer і боти (720+
// запитів на добу, справжні скани між ними не видно), а JavaScript вони не
// виконують. Тож подія `qr` означає саме «людина відкрила застосунок з QR»
// (власник, 12.10.2026).
//
// Точку, що привела людину, і звідки саме (наклейка чи QR бонусу на моніторі
// кіоска) кладемо в localStorage один раз — першу, — і після входу api пише
// їх у users.metadata.qr_pos / qr_via (теж один раз, сервер не перезаписує):
// з них адмінка веде воронку «скан → акаунт → бонус → повернувся» окремо
// для наклейки й для монітора (власник, 15.10.2026). Параметр з адреси
// прибираємо одразу: інакше він розходився б разом із посиланням і кожне
// пересилання рахувалось би сканом.
import { api } from "./api.js";
import { trackQr } from "./analytics.js";

const KEY = "qr_pos";
const VIA = "qr_via";
const SENT = "qr_pos_sent";
const POS = /^[A-Za-z0-9_-]{1,16}$/;

/** Забрати ?p= з адреси до будь-яких replaceState: записати скан і точку. */
export function takeQrPos() {
  const url = new URL(window.location.href);
  const pos = url.searchParams.get("p");
  if (!pos || !POS.test(pos)) return null;
  const via = url.pathname.startsWith("/b/") ? "bonus" : "sticker";
  try {
    if (!localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, pos);
      localStorage.setItem(VIA, via);
    }
  } catch { /* приватний режим — скан однаково рахуємо */ }
  trackQr(pos, via);
  url.searchParams.delete("p");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  return pos;
}

/** Після входу — віддати точку в акаунт, один раз на браузер. */
export async function reportQrPos() {
  let pos, via;
  try {
    pos = localStorage.getItem(KEY);
    via = localStorage.getItem(VIA) ?? undefined;
    if (!pos || localStorage.getItem(SENT) === pos) return;
  } catch { return; }
  try {
    await api.post("/me/qr", { pos, via });
    localStorage.setItem(SENT, pos);
  } catch { /* наступний вхід спробує ще раз */ }
}
