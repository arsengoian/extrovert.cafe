// «Підтримка» — одразу в Telegram-бот (docs/gamification_ui.md): кнопка в
// шапці, посилання внизу стартового екрана, рядок у профілі й посилання в
// документах. Окремого екрана підтримки немає: розмова з людиною живе в
// Telegram, а поламки йдуть через «Повідомити про проблему».
import { api } from "../api.js";
import { ResultPopup } from "./Popup.jsx";

const MESSAGES = {
  support_not_connected: "Бот підтримки ще не підключений – поки напиши через «Повідомити про проблему».",
};

// Safari на телефоні віддає t.me застосунку Telegram і нікуди не переходить
// сам — порожня вкладка, відкрита «про запас», так і лишається висіти
// (скарга власника 23.09.2026). Тому там ведемо поточну вкладку: Telegram
// однаково перехопить посилання, а сторінка застосунку лишиться на місці.
const SAFARI = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// notify — ctx.notify: куди показати, якщо бот недоступний.
export async function openSupport(notify) {
  // В інших переглядачах вкладку відкриваємо ще в жесті тапу, а адресу
  // підставляємо, коли api видасть одноразовий код: вікно, відкрите після
  // await, браузер заблокує.
  const tab = SAFARI || IOS ? null : window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const { url } = await api.post("/support/link");
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    const text = MESSAGES[e.body?.error] ?? "Не вдалося відкрити підтримку – спробуй ще раз.";
    const close = () => notify?.(null);
    if (notify) {
      notify(
        <ResultPopup title="Підтримка" action="Зрозуміло" onClose={close}>
          <div className="result-note">{text}</div>
        </ResultPopup>
      );
    }
  }
}
