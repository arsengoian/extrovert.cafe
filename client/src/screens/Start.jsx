// Стартовий екран: лого, кавенятко, обіцянка бонусів і вхід.
// Google/Apple ще немає (docs/services.md §3) — поки девелоперський вхід.
import { useState } from "react";
import { api } from "../api.js";

export function Start({ onSignedIn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.devLogin("dev");
      await onSignedIn();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="stage" style={{ background: "linear-gradient(180deg, var(--sky1), var(--sky2))" }}>
      <div className="stage-pad" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <img src="/assets/logo_dark.svg" alt="extrovert.cafe" style={{ width: 168, margin: "18px auto 10px" }} />

        <img src="/assets/ui/hero_bush.png" alt="Кавенятко" style={{ width: 220, margin: "6px auto" }} />
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="h1">Твоє кавенятко</div>
          <p className="muted" style={{ margin: 0 }}>
            Вирости мене — я вмію розмовляти і дарувати речі в реальному світі
          </p>
        </div>

        <div className="panel">
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Увійди, щоб не втратити бонуси</div>
          <div className="row" style={{ gap: 18, justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 34, margin: "0 auto 4px" }} />
              <div style={{ fontWeight: 800 }}>+180</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <img src="/assets/ui/hat.png" alt="" style={{ width: 40, margin: "0 auto 4px" }} />
              <div style={{ fontSize: 12, lineHeight: 1.2 }}>Капелюх<br />«Ковбой»</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "grid", gap: 10, paddingTop: 18 }}>
          {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
          <button className="btn btn-primary" disabled={busy} onClick={signIn}>
            {busy ? "Заходимо…" : "Увійти (девелоперський вхід)"}
          </button>
          <button className="btn" disabled title="Поки не підключено">Увійти через Google</button>
          <button className="btn" disabled title="Поки не підключено">Увійти через Apple</button>
        </div>
      </div>
    </div>
  );
}
