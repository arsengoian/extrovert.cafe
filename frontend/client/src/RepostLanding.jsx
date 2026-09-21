// Сторінка /r/<token> — те, що відкриває людина з чужої сторіс. Вона нічого
// не вирішує сама: стукає в api (той зарахує перехід, якщо це перший і не
// власний) і веде далі в застосунок. Редирект робимо в будь-якому разі —
// впала мережа чи ні, гостя це не має обходити.
import { useEffect } from "react";
import { api } from "./api.js";

export function RepostLanding({ token }) {
  useEffect(() => {
    const go = () => window.location.replace("/");
    api.post(`/repost/visit/${encodeURIComponent(token)}`).catch(() => {}).finally(() => setTimeout(go, 400));
  }, [token]);

  return (
    <div className="app">
      <div className="stage" style={{ display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
        <div>
          <img src="/assets/ui/hero_bush.png" alt="Кавенятко" style={{ width: 180 }} />
          <div className="h1" style={{ marginTop: 14 }}>extrovert.cafe</div>
          <p className="muted">Відкриваємо застосунок…</p>
        </div>
      </div>
    </div>
  );
}
