// Видалення акаунта. Екран говорить правду про те, що саме станеться:
// пошта стирається й увійти більше не можна, але історія покупок і угоди
// на маркеті лишаються — на них тримається звітність точки й картина
// другої сторони угоди.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const WORD = "видалити";

export function DeleteAccount({ ctx }) {
  const [state, setState] = useState(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/me/deletion").then(setState).catch((e) => setError(e.message)); }, []);

  if (done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <div className="h2">Акаунт видалено</div>
          <p className="muted">
            Тепер це {done.nickname}. Увійти в нього більше не можна — ні через Google, ні через Apple.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Закрити</button>
        </div>
      </div>
    );
  }

  if (error && !state) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!state) return <div className="stage-pad"><div className="skeleton" /></div>;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post("/me/deletion", { confirm: word.trim().toLowerCase() }));
    } catch (e) {
      setError(e.body?.error === "confirm_required" ? `Напиши «${WORD}», щоб підтвердити` : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <div className="panel" style={{ borderColor: "var(--accent)" }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Що зникне</div>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0, paddingLeft: 18 }}>
          <li>вхід: пошта стирається, Google і Apple відвʼязуються назавжди</li>
          <li>нікнейм звільняється, акаунт стає «deleted_account_…»</li>
          {state.listings > 0 && <li>лоти на маркеті знімаються з продажу ({state.listings})</li>}
          <li>
            баланси лишаються на рахунку, але витратити їх буде нікому:
            {" "}{state.coins} монет, {state.beans} зерен
          </li>
        </ul>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Що лишиться</div>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0, paddingLeft: 18 }}>
          {state.keeps.map((k) => <li key={k}>{k}</li>)}
        </ul>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Дію не можна скасувати. Напиши «{WORD}», щоб підтвердити.
      </p>
      <input className="price-input" style={{ width: "100%", fontSize: 15 }} value={word}
             placeholder={WORD} onChange={(e) => setWord(e.target.value)} />

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-danger" style={{ marginTop: 12 }}
              disabled={busy || word.trim().toLowerCase() !== WORD} onClick={remove}>
        {busy ? "Видаляємо…" : "Видалити акаунт назавжди"}
      </button>
    </div>
  );
}
