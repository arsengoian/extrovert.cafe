import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { RepostLanding } from "./RepostLanding.jsx";
import "./theme.css";

// Два шляхи поза звичайним застосунком. Роутера немає (див. app.jsx), тож
// розбираємо їх тут, до монтування:
//   /r/<token> — посилання-репост, окрема сторінка для гостя;
//   /b/<token> — бонус за чек із QR на кіоску: це той самий застосунок,
//                просто з екраном бонусу поверх.
const repost = window.location.pathname.match(/^\/r\/([^/?#]+)/);
const bonus = window.location.pathname.match(/^\/b\/([^/?#]+)/);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {repost ? <RepostLanding token={decodeURIComponent(repost[1])} /> : <App bonusToken={bonus ? decodeURIComponent(bonus[1]) : null} />}
  </StrictMode>
);
