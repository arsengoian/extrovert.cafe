// «Попап · профіль»: хто ти, зміна нікнейма, тема, документи й вихід —
// плаваюча картка внизу поверх поточної вкладки.
import { useState } from "react";
import { api } from "../api.js";
import { ConfirmSheet } from "../ui/Popup.jsx";
import { getThemeMode, setThemeMode } from "../theme.js";

const PROVIDER = { google: "Google", apple: "Apple", dev: "Девелоперський вхід" };
const THEMES = [
  { id: "system", label: "Як у пристрої" },
  { id: "light", label: "Світла" },
  { id: "dark", label: "Темна" },
];

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round">
    <path d="M9.5 6 15.5 12 9.5 18" />
  </svg>
);

export function Profile({ ctx }) {
  const [mode, setMode] = useState(getThemeMode());
  const me = ctx.me;
  const pick = (id) => { setThemeMode(id); setMode(id); };

  return (
    <ConfirmSheet onCancel={ctx.pop} closable padding="18px 16px">
      <div className="profile-head">
        <img src="/assets/ui/nav_profile.png" alt="" />
        <div>
          <b>{me?.nickname}</b>
          <small>
            {PROVIDER[me?.identity?.provider] ?? me?.identity?.provider}
            {me?.identity?.email ? ` · ${me.identity.email}` : ""}
          </small>
        </div>
      </div>

      <button className="profile-btn" onClick={() => ctx.push("nicknameChange")}>Змінити нікнейм</button>

      <div className="profile-theme">
        <div className="profile-label">Тема</div>
        <div className="seg">
          {THEMES.map((t) => (
            <button key={t.id} data-on={mode === t.id} onClick={() => pick(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="profile-links">
        <button onClick={() => ctx.push("terms")}><span>Умови користування</span><Chevron /></button>
        <button onClick={() => ctx.push("privacy")}><span>Політика приватності</span><Chevron /></button>
        <button onClick={() => ctx.support()}><span>Підтримка</span><Chevron /></button>
      </div>

      <button className="profile-out" onClick={() => api.logout().finally(() => location.reload())}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8" /><path d="M17 15.5 20.5 12 17 8.5" /><path d="M20.5 12H10" />
        </svg>
        Вийти
      </button>
      {/* Політика приватності обіцяє: «Видалити акаунт можна з профілю». */}
      <button className="doc-link delete-link" onClick={() => ctx.push("deleteAccount")}>Видалити акаунт</button>
    </ConfirmSheet>
  );
}
