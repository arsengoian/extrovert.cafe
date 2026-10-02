// Статуси замовлень за зерна — одним словником для api (картки
// замовлень, адмінка) і scheduler (трекінг Нової Пошти), і один текст
// сповіщення в чат про зміну статусу (gamification_ui.md, «Сповіщення»).

// Назви — як у кадрах «Мої замовлення».
export const ORDER_STATUS_LABEL = {
  new: "Нове",
  printing: "Друкуємо",
  packing: "Пакуємо",
  shipped: "Відправлено",
  arrived: "Прибуло у відділення",
  received: "Отримано",
  returned: "Повернуто",
  cancelled: "Скасовано",
};

// Посилання на картку замовлення в тексті сповіщення: чат малює токен
// кнопкою, що відкриває «Мої замовлення → картку» (client/src/screens/Chat.jsx),
// а моделі він іде без токена (api/src/chat/prompt.js).
export const orderLink = (id) => `[order:${id}]`;

export const orderNotice = (id, status, kind = null) => {
  const label = status === "arrived" && kind === "postomat" ? "Прибуло в поштомат" : ORDER_STATUS_LABEL[status] ?? status;
  return `Замовлення №${id}: ${label}. ${orderLink(id)}`;
};
