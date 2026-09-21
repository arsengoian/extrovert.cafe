// Профіль — шторка поверх поточної вкладки: хто ти, тема, документи, вихід.
import { useState } from "react";
import { api } from "../api.js";
import { Sheet } from "../ui/Sheet.jsx";
import { getThemeMode, setThemeMode } from "../theme.js";

const PROVIDER = { google: "Google", apple: "Apple", dev: "Девелоперський вхід" };
const THEMES = [
  { id: "system", label: "Як у пристрої" },
  { id: "light", label: "Світла" },
  { id: "dark", label: "Темна" },
];

export function Profile({ ctx }) {
  const [mode, setMode] = useState(getThemeMode());
  const me = ctx.me;

  const pick = (id) => { setThemeMode(id); setMode(id); };

  return (
    <Sheet title="Профіль" onClose={ctx.pop}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="icon-btn" style={{ width: 46, height: 46 }}>
          <img src="/assets/ui/nav_profile.png" alt="" style={{ width: 22 }} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{me?.nickname}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {PROVIDER[me?.identity?.provider] ?? me?.identity?.provider}
            {me?.identity?.email ? ` · ${me.identity.email}` : ""}
          </div>
        </div>
      </div>

      <button className="btn" onClick={() => ctx.push("nicknameChange")}>Змінити нікнейм</button>

      <div className="sectionTitle" style={{ margin: "16px 4px 8px" }}>Тема</div>
      <div className="row" style={{ gap: 8 }}>
        {THEMES.map((t) => (
          <button key={t.id} className="btn" style={{
            height: 40, fontSize: 13,
            background: mode === t.id ? "var(--grad)" : "var(--panel2)",
            color: mode === t.id ? "var(--accent-ink)" : "var(--ink)",
            border: mode === t.id ? 0 : "1px solid var(--line)",
          }} onClick={() => pick(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={() => ctx.push("terms")}>Умови користування</button>
        <button className="btn" onClick={() => ctx.push("privacy")}>Політика приватності</button>
        <button className="btn" onClick={() => ctx.push("support")}>Підтримка</button>
      </div>

      <button className="btn" style={{ marginTop: 16, color: "var(--accent-text)" }}
              onClick={() => api.logout().finally(() => location.reload())}>
        Вийти
      </button>
      {/* Видалення живе тут, а не серед налаштувань: політика приватності
          обіцяє його саме в профілі. */}
      <button className="btn" style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}
              onClick={() => ctx.push("deleteAccount")}>
        Видалити акаунт
      </button>
    </Sheet>
  );
}
