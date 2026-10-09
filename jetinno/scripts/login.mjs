// Автоматичний вхід у портал Jetinno і запис куки в jetinno/cookie.txt — ту
// саму, що читають решта скриптів (status.mjs, set-price.mjs тощо).
//
//   bun jetinno/scripts/login.mjs
//
// Вхід робить login() з @extrovert/lib/jetinno/portal.js: бере сесію,
// розв'язує капчу твоєю solveCaptcha (у portal.js), шле /dologin з
// JETINNO_LOGIN/JETINNO_PASSWORD. Тут Redis не потрібен (кука йде у файл),
// тож даємо заглушку замість клієнта.
//
// Запускати там, де резолвиться твій OCR (solveCaptcha ходить у ddddocr) і де
// в env є JETINNO_LOGIN / JETINNO_PASSWORD. Капчу розв'язує твій код — Claude
// у solveCaptcha не втручається.
import { writeFileSync } from "node:fs";
import { login } from "@extrovert/lib/jetinno/portal.js";

const COOKIE = new URL("../cookie.txt", import.meta.url);

const { cookie } = await login({ redis: { set: async () => {} } }).catch((e) => {
  console.error(`✗ вхід не вдався: ${e.message}`);
  process.exit(1);
});
if (!cookie) { console.error("✗ вхід не повернув куки"); process.exit(1); }

writeFileSync(COOKIE,
  "# Згенеровано jetinno/scripts/login.mjs (автоматичний вхід). Перезапусти,\n" +
  "# коли сесія злетить. Рядки з # ігноруються рештою скриптів.\n" +
  cookie + "\n");
console.log("✓ сесію записано в jetinno/cookie.txt");
