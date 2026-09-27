// Прохання про лист, на яке чекає цей браузер: секрет очікування з
// POST /auth/email і до коли він живий (docs/services.md §3, «Вхід
// гравця»).
//
// Лежить у localStorage, а не в пам'яті вкладки, з двох причин:
//   1. посилання, відкрите в ТОМУ Ж браузері (лист в іншій вкладці на ПК),
//      бачить запис і входить одразу, без питання «Це ти входиш?» — цей
//      браузер сам просив лист (main.jsx);
//   2. перезавантажена сторінка входу продовжує чекати, а не губить
//      прохання (app.jsx).
const KEY = "extrovert.loginWait";

export function readLoginWait() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || "null");
    return w && w.wait && w.until > Date.now() ? w : null;
  } catch {
    return null;
  }
}

export function saveLoginWait(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* приватний режим — чекаємо лише в пам'яті */ }
}

export function clearLoginWait() {
  try { localStorage.removeItem(KEY); } catch { /* приватний режим */ }
}
