// «Опитування про напій» — кадр з таким самим ім'ям: картка напою, чотири
// шкали й необов'язковий текст. Опитування завжди про конкретну покупку:
// його відкривають із картки напою в «Покупках», звідти й item.
// Одне опитування — на одне замовлення (economy §2.4).
import { useEffect, useState } from "react";
import { markCoinSource } from "../ui/fx.jsx";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";

export function QuizDrink({ item: picked = null, ctx }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get("/quiz/drink").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error && !data) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Без обраної покупки (старе посилання) — перша, про яку ще не питали.
  const item = picked ?? data.items.find((i) => !i.answered) ?? null;

  if (!data.credits || !item) {
    return (
      <div className="stage-pad">
        <div className="panel">
          <div className="h2">Поки немає доступного опитування</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Кредити на опитування нараховуються на 1-му, 4-му й далі кожному 10-му напої.
          </p>
        </div>
      </div>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/quiz/drink", { receipt_item_id: item.id, answers, free_text: text });
      await ctx.refreshMe();
      setDone(true);
    } catch (e) {
      setError(e.body?.error === "no_credits" ? "Кредит уже витрачено"
        : e.body?.error === "already_answered" ? "Про цей напій уже відповідали"
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  const when = new Date(item.fiscal_date);
  const price = item.price_uah ?? item.sum;

  return (
    <div className="quiz">
      <div className="drink-card">
        <img src={item.sprite ? `/assets/drinks/${item.sprite}.png` : "/assets/ui/coffee250.png"} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{item.name}</b>
          <small>
            {item.point_name} · {when.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })} · {price} ₴
          </small>
        </div>
        <span><img src="/assets/ui/coin_silver.png" alt="" />+{data.reward}</span>
      </div>

      <div className="section" style={{ gap: 12 }}>
        <div className="sectionTitle">Як смакувало</div>
        {data.scales.map((sc) => (
          <div key={sc.id} className="scale">
            <b>{sc.title}</b>
            <div className="segs sm">
              {sc.options.map((o) => (
                <button key={o} aria-pressed={answers[sc.id] === o}
                        onClick={() => setAnswers((a) => ({ ...a, [sc.id]: o }))}>{o}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <textarea className="textarea lg" value={text} rows={2}
                placeholder={data.free_text?.placeholder ?? "Що покращити? (не обов'язково)"}
                onChange={(e) => setText(e.target.value)} />

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" disabled={busy} onClick={send}>
        {busy ? "Надсилаємо…" : <>Надіслати й отримати {data.reward} <img src="/assets/ui/coin_silver.png" alt="срібні монети" /></>}
      </button>

      {done && (
        <ResultPopup
          art={<img ref={markCoinSource} className="fx-pop" src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 62, height: 65 }} />}
          title="Дякуємо за відгук"
          onClose={ctx.pop}
        >
          <div className="result-sum">
            <img src="/assets/ui/coin_silver.png" alt="срібних монет" />{data.reward}
          </div>
        </ResultPopup>
      )}
    </div>
  );
}
