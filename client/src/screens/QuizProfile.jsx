// «Розкажи про себе»: шість кроків із дизайну. Питання приходять з api
// (api/data/quiz.json), тому новий варіант відповіді — це зміна файла, а
// не реліз клієнта.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Choice, Segment, TextField } from "../ui/Fields.jsx";

export function QuizProfile({ ctx }) {
  const [quiz, setQuiz] = useState(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => { api.get("/quiz/profile").then(setQuiz).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!quiz) return <div className="stage-pad"><div className="skeleton" /></div>;

  if (done || quiz.done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/coin_silver.png" alt="" style={{ width: 54, margin: "6px auto 10px" }} />
          <div className="h2">{done ? `+${quiz.reward} срібних` : "Анкету вже заповнено"}</div>
          <p className="muted">
            {done
              ? "Дякуємо — це допомагає зрозуміти, яку каву тобі варто пропонувати."
              : "Анкета проходиться один раз. Далі монети дає квіз про напій після покупок."}
          </p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  const current = quiz.steps[step];
  const last = step === quiz.steps.length - 1;
  const set = (id, value) => setAnswers((a) => ({ ...a, [id]: value }));

  const next = async () => {
    if (!last) { setStep(step + 1); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post("/quiz/profile", { answers });
      await ctx.refreshMe();
      setDone(true);
    } catch (e) {
      setError(e.body?.error === "already_done" ? "Анкета вже заповнена" : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--panel2)", overflow: "hidden" }}>
          <div style={{ width: `${((step + 1) / quiz.steps.length) * 100}%`, height: "100%", background: "var(--grad)" }} />
        </div>
        <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{step + 1} / {quiz.steps.length}</div>
      </div>

      <div className="h1" style={{ fontSize: 20 }}>{current.title}</div>
      {current.hint && <p className="muted" style={{ marginTop: 0 }}>{current.hint}</p>}

      {current.questions.map((q) => (
        <div key={q.id} className="panel">
          {q.title && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{q.title}</div>}
          {q.type === "single" && (
            <Choice options={q.options} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          )}
          {q.type === "multi" && (
            <Choice options={q.options} multi value={answers[q.id] ?? []} onChange={(v) => set(q.id, v)} />
          )}
          {q.type === "segment" && (
            <Segment options={q.options} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          )}
          {q.type === "text" && (
            <TextField value={answers[q.id] ?? ""} placeholder={q.placeholder} onChange={(v) => set(q.id, v)} />
          )}
        </div>
      ))}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="row-between" style={{ marginTop: 14 }}>
        <span className="price muted" style={{ fontSize: 13 }}>
          <img src="/assets/ui/coin_silver.png" alt="" />+{quiz.reward} за опитування
        </span>
        <button className="btn btn-primary" style={{ width: "auto", padding: "0 28px" }} disabled={busy} onClick={next}>
          {last ? (busy ? "Зберігаємо…" : "Завершити") : "Далі"}
        </button>
      </div>
    </div>
  );
}
