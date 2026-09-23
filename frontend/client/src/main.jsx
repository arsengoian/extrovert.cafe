import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { api } from "./api.js";
import { RepostLanding } from "./RepostLanding.jsx";
import { installTapFx } from "./ui/fx.jsx";
import "./theme.css";

// Кільце тапу — один слухач на весь документ, а не обгортка кожної кнопки.
installTapFx();

// Два шляхи поза звичайним застосунком. Роутера немає (див. app.jsx), тож
// розбираємо їх тут, до монтування:
//   /r/<token> — посилання-репост, окрема сторінка для гостя;
//   /b/<token> — бонус за чек із QR на кіоску: це той самий застосунок,
//                просто з екраном бонусу поверх.
const repost = window.location.pathname.match(/^\/r\/([^/?#]+)/);
const bonus = window.location.pathname.match(/^\/b\/([^/?#]+)/);
// Токен бонусу забираємо з адреси одразу, як і токен входу нижче: далі він
// живе в памʼяті сторінки, а перезавантаження має відкривати звичайний
// extrovert.cafe, а не намагатись забрати бонус ще раз (рішення власника
// 23.09.2026). Куди вертатись після входу, застосунок знає й без адреси —
// він передає /b/<токен> у next.
if (bonus) window.history.replaceState({}, "", "/");
// ?pay=1 — повернення з платіжної сторінки mono. Ідентифікатор платежу
// лежить у localStorage: в адресі його немає навмисно.
const returningFromPayment = new URLSearchParams(window.location.search).has("pay");
// /login#<токен> — посилання з листа для входу. Токен забираємо з адреси
// до монтування, щоб він не лишився в історії браузера, і міняємо на сесію
// рівно один раз: StrictMode запускає ефекти двічі, а посилання одноразове.
const loginToken = window.location.pathname === "/login" ? window.location.hash.slice(1) : null;
if (window.location.pathname === "/login") window.history.replaceState({}, "", "/");
const login = loginToken ? api.emailVerify(loginToken) : null;

// Google повертає сюди з ?login=<причина>, якщо вхід не склався. Адресу
// одразу чистимо, щоб перезавантаження не показувало те саме вдруге.
const GOOGLE_NOTE = {
  google_off: "Вхід через Google поки не налаштований – заходь через пошту",
  google_cancelled: "Вхід через Google скасовано",
  google_expired: "Сторінка входу застаріла – спробуй ще раз",
  google_unverified: "Google не підтвердив цю пошту – заходь через пошту",
  google_failed: "Google не пустив – спробуй ще раз або заходь через пошту",
};
const loginNote = GOOGLE_NOTE[new URLSearchParams(window.location.search).get("login")] ?? null;
if (loginNote) window.history.replaceState({}, "", window.location.pathname);
// Постійні адреси документів — на них посилаються ззовні (екран згоди
// Google OAuth, Mailgun, сторінки магазинів застосунків), тож вони мають
// відкриватись самі по собі, і з акаунтом, і без.
const legalDoc = { "/privacy-policy": "privacy", "/terms": "terms" }[window.location.pathname] ?? null;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {repost ? <RepostLanding token={decodeURIComponent(repost[1])} /> : <App bonusToken={bonus ? decodeURIComponent(bonus[1]) : null} returningFromPayment={returningFromPayment} login={login} legalDoc={legalDoc} loginNote={loginNote} />}
  </StrictMode>
);
