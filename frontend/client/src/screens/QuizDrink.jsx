// «Опитування про напій»: шкали з дизайну, один кредит на квіз
// (economy §2.4). Якщо кредитів немає — чесно кажемо, коли буде наступний.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Segment, TextField } from "../ui/Fields.jsx";

export function QuizDrink({ ctx }) {
  const [data, setData] = useState(null);
  const [item, setItem] = useState(null);
  const [answers, setAnswers] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get("/quiz/drink")
      .then((d) => { setData(d); setItem(d.items.find((i) => !i.answered) ?? null); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  if (done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/coin_silver.png" alt="" style={{ width: 54, margin: "6px auto 10px" }} />
          <div className="h2">+{data.reward} срібних</div>
          <p className="muted">Дякуємо. Наступний квіз відкриється з новими покупками.</p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  if (!data.credits || !item) {
    return (
      <div className="stage-pad">
        <div className="panel">
          <div className="h2">Поки немає доступного квіза</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Кредит відкривається на 1-му, 4-му, 10-му напої й далі на кожному десятому.
            Зараз напоїв: {data.drinks}.
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
      setError(e.body?.error === "no_credits" ? "Кредит уже витрачено" : e.message);
    } finally {
      setBusy(false);
    }
  };

  const when = new Date(item.fiscal_date);
  const others = data.items.filter((i) => !i.answered && i.id !== item.id);

  return (
    <div className="stage-pad">
      <div className="panel row-between">
        <div>
          <div style={{ fontWeight: 800 }}>{item.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {item.point_name} · {when.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })} · {item.price_uah} ₴
          </div>
        </div>
        <span className="price"><img src="/assets/ui/coin_silver.png" alt="" />+{data.reward}</span>
      </div>

      <div className="sectionTitle">Як смакувало</div>
      {data.scales.map((s) => (
        <div key={s.id} className="panel">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{s.title}</div>
          <Segment options={s.options} value={answers[s.id]}
                   onChange={(v) => setAnswers((a) => ({ ...a, [s.id]: v }))} />
        </div>
      ))}

      <div className="panel">
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{data.free_text.title}</div>
        <TextField value={text} onChange={setText} placeholder={data.free_text.placeholder} rows={3} />
      </div>

      {others.length > 0 && (
        <button className="btn" onClick={() => { setItem(others[0]); setAnswers({}); setText(""); }}>
          Про інше замовлення
        </button>
      )}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={send}>
        {busy ? "Надсилаємо…" : `Надіслати й отримати ${data.reward}`}
      </button>
    </div>
  );
}
