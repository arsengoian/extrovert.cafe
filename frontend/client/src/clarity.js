// Microsoft Clarity — записи сесій і теплові карти (власник, 02.10.2026).
// Лише в проді: прод-збірка (не dev-сервер) і лише на extrovert.cafe — ні
// локальний `vite preview`, ні превʼю-домен воркера не мають засмічувати
// записи. ID проєкту — у .env.production, як DSN GlitchTip: це не секрет.
//
// Записи бачать усе, що бачить гравець, тож усе, що він пише сам або що
// його ідентифікує (чат, імʼя й телефон отримувача, адреса), позначене
// data-clarity-mask — Clarity замінює це заглушкою ще в браузері. Поля
// вводу Clarity маскує й сам.
const ID = import.meta.env.VITE_CLARITY_ID;
const enabled = import.meta.env.PROD && Boolean(ID) && window.location.hostname === "extrovert.cafe";

export function initClarity() {
  if (!enabled) return;
  // Офіційний сніпет: черга викликів до приходу скрипта, потім сам скрипт.
  window.clarity = window.clarity || function () {
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${ID}`;
  document.head.appendChild(script);
}

// Хто в сесії — лише id акаунта (Clarity ще й хешує його в браузері): так
// запис можна знайти за скаргою конкретного гравця, не знаючи його пошти.
export function clarityUser(id) {
  if (enabled && id) window.clarity?.("identify", String(id));
}

// Екран — тегом: записи фільтруються за ним у Clarity.
export function clarityScreen(name) {
  if (enabled && name) window.clarity?.("set", "screen", String(name));
}
