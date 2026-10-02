// «Опитування про напій» — кадр з таким самим ім'ям: картка напою, чотири
// шкали й необов'язковий текст. Опитування завжди про конкретну покупку:
// його відкривають із картки напою в «Покупках», звідти й item.
// Одне опитування — на одне замовлення (economy §2.4).
import { useEffect, useState } from "react";
import { markCoinSource } from "../ui/fx.jsx";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { Img } from "../ui/img.jsx";

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

  if (!item) {
    return (
      <div className="stage-pad">
        <div className="panel">
          <div className="h2">Поки немає доступного опитування</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Можливість отримати бонуси за відгук відкривається на 1-му, 4-му й далі кожному 10-му напої.
          </p>
        </div>
      </div>
    );
  }

  // Кредити скінчились — відгук приймається, але без монет: обіцяти
  // нагороду, якої не буде, не можна (рішення власника 23.09.2026).
  const paid = data.credits > 0;
  // Про молоко в каві без молока не питаємо (skip_for у quiz.json). Решта
  // шкал обов'язкові, без варіанта за замовчуванням; необов'язковий лише
  // текст (власник, 01.10.2026).
  const scales = data.scales.filter((sc) => !(sc.skip_for ?? []).includes(item.sprite));
  const complete = scales.every((sc) => answers[sc.id]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/quiz/drink", { receipt_item_id: item.id, answers, free_text: text });
      await ctx.refreshMe();
      setDone(true);
    } catch (e) {
      setError(e.body?.error === "already_answered" ? "Про цей напій уже відповідали"
        : e.body?.error === "incomplete" ? "Обери по варіанту в кожному рядку"
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
        <Img src={item.sprite ? `/assets/drinks/${item.sprite}.png` : "/assets/ui/coffee250.png"} sizes="46px" alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{item.name}</b>
          <small>
            {item.point_name}, {when.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}<i className="vsep" />{price} ₴
          </small>
        </div>
        {paid && <span><img src="/assets/ui/coin_silver.webp" alt="" />+{data.reward}</span>}
      </div>

      <div className="section" style={{ gap: 12 }}>
        <div className="sectionTitle">Як смакувало</div>
        {scales.map((sc) => (
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

      <textarea className="textarea lg" value={text} rows={2} maxLength={2000}
                placeholder={data.free_text?.placeholder ?? "Що покращити? (не обов'язково)"}
                onChange={(e) => setText(e.target.value)} />

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" disabled={busy || !complete} onClick={send}>
        {busy ? "Надсилаємо…"
          : paid ? <>Надіслати й отримати {data.reward} <img src="/assets/ui/coin_silver.webp" alt="срібні монети" /></>
          : "Надіслати відгук"}
      </button>

      {done && (
        <ResultPopup
          art={<img ref={markCoinSource} className="fx-pop" src="/assets/ui/coin_silver.webp" alt="срібні монети" style={{ width: 62, height: 65 }} />}
          title="Дякуємо за відгук"
          onClose={ctx.pop}
        >
          {paid
            ? <div className="result-sum"><img src="/assets/ui/coin_silver.webp" alt="срібних монет" />{data.reward}</div>
            : <div className="short-note" style={{ textAlign: "center" }}>Ми його обовʼязково прочитаємо.</div>}
        </ResultPopup>
      )}
    </div>
  );
}
