import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { RepostLanding } from "./RepostLanding.jsx";
import "./theme.css";

// Єдиний публічний шлях поза застосунком — посилання-репост /r/<token>.
// Роутера немає (див. app.jsx), тож розбираємо шлях тут, до монтування.
const repost = window.location.pathname.match(/^\/r\/([^/?#]+)/);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {repost ? <RepostLanding token={decodeURIComponent(repost[1])} /> : <App />}
  </StrictMode>
);
