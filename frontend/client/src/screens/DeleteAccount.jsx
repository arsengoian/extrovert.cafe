// Видалення акаунта. Екран говорить правду про те, що саме станеться:
// пошта стирається й увійти більше не можна, але історія покупок і угоди
// на маркеті лишаються — на них тримається звітність точки й картина
// другої сторони угоди.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { useConfirmWord } from "../ui/confirmWord.js";

const WORD = "видалити";

export function DeleteAccount({ ctx }) {
  const [state, setState] = useState(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useConfirmWord(word, WORD);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/me/deletion").then(setState).catch((e) => setError(e.message)); }, []);

  if (done) {
    return (
      <div className="stage-pad">
        {/* Без пояснень про deleted_account_N: людині вже нема куди
            повертатись, а внутрішня кухня її не стосується. */}
        <div className="panel" style={{ textAlign: "center" }}>
          <div className="h2">Акаунт видалено</div>
          <button className="btn btn-primary" onClick={() => location.reload()}>Закрити</button>
        </div>
      </div>
    );
  }

  if (error && !state) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!state) return <div className="stage-pad"><div className="skeleton" /></div>;

  const remove = async () => {
    if (!check.ok()) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post("/me/deletion", { confirm: word.trim().toLowerCase() }));
    } catch (e) {
      setError(e.body?.error === "confirm_required" ? `Напиши «${WORD}», щоб підтвердити` : errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      {/* Списки «що зникне / що лишиться» тут стояли до 23.09.2026: це
          наша внутрішня бухгалтерія, а не те, з чим людина ухвалює рішення.
          Лишилось головне — вхід зникає, і повернути його не можна. */}
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Акаунт буде видалено назавжди: пошта стирається, нікнейм
        звільняється, лоти знімаються з ринку{state.listings > 0 ? " (" + state.listings + ")" : ""}.
        Дію не можна скасувати. Напиши «{WORD}», щоб підтвердити.
      </p>
      {/* Власний клас, а не .price-input: у колонковому флексі його
          flex: 1 0% стискав поле по висоті майже в нитку. */}
      <input ref={check.ref} className="confirm-input" value={word} data-invalid={check.invalid || undefined}
             placeholder={WORD} onChange={(e) => { setWord(e.target.value); check.reset(); }} />
      {check.invalid && <p className="confirm-hint">Напиши «{WORD}», щоб підтвердити</p>}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-danger" style={{ marginTop: 12 }}
              disabled={busy} onClick={remove}>
        {busy ? "Видаляємо…" : "Видалити акаунт назавжди"}
      </button>
    </div>
  );
}
