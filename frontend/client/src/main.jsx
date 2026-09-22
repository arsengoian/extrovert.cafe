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
// ?pay=1 — повернення з платіжної сторінки mono. Ідентифікатор платежу
// лежить у localStorage: в адресі його немає навмисно.
const returningFromPayment = new URLSearchParams(window.location.search).has("pay");
// /login#<токен> — посилання з листа для входу. Токен забираємо з адреси
// до монтування, щоб він не лишився в історії браузера, і міняємо на сесію
// рівно один раз: StrictMode запускає ефекти двічі, а посилання одноразове.
const loginToken = window.location.pathname === "/login" ? window.location.hash.slice(1) : null;
if (window.location.pathname === "/login") window.history.replaceState({}, "", "/");
const login = loginToken ? api.emailVerify(loginToken) : null;
// Постійні адреси документів — на них посилаються ззовні (екран згоди
// Google OAuth, Mailgun, сторінки магазинів застосунків), тож вони мають
// відкриватись самі по собі, і з акаунтом, і без.
const legalDoc = { "/privacy-policy": "privacy" }[window.location.pathname] ?? null;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {repost ? <RepostLanding token={decodeURIComponent(repost[1])} /> : <App bonusToken={bonus ? decodeURIComponent(bonus[1]) : null} returningFromPayment={returningFromPayment} login={login} legalDoc={legalDoc} />}
  </StrictMode>
);
