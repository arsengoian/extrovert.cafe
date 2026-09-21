// «Розкажи про себе»: шість кроків із дизайну. Питання приходять з api
// (backend/api/data/quiz.json), тому новий варіант відповіді — це зміна файла, а
// не реліз клієнта.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Choice, DrinkGrid, Segment, TextField } from "../ui/Fields.jsx";

// Чернетка анкети. Сервер приймає відповіді цілком і в кінці, тому «крок 3
// з 6» існує лише на клієнті — а гаманець його показує (макет «Гаманець ·
// опитування в процесі»). Без збереження вихід з екрана стирав би все.
export const PROFILE_DRAFT = "extrovert.quiz.profile";

const loadDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_DRAFT)) ?? { step: 0, answers: {} };
  } catch {
    return { step: 0, answers: {} };
  }
};

export function QuizProfile({ ctx }) {
  const draft = loadDraft();
  const [quiz, setQuiz] = useState(null);
  const [step, setStep] = useState(draft.step ?? 0);
  const [answers, setAnswers] = useState(draft.answers ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => { api.get("/quiz/profile").then(setQuiz).catch((e) => setError(e.message)); }, []);

  // Пишемо чернетку на кожну відповідь: гравця перервуть на півкроці —
  // телефон дзвонить, вкладка засинає, — і повертатись з нуля він не стане.
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_DRAFT, JSON.stringify({ step, answers }));
    } catch { /* приватний режим — просто без чернетки */ }
  }, [step, answers]);

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
              ? "Дякуємо – це допомагає зрозуміти, яку каву тобі варто пропонувати."
              : "Анкета проходиться один раз. Далі монети дає квіз про напій після покупок."}
          </p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  const current = quiz.steps[step];
  const last = step === quiz.steps.length - 1;
  // value може бути функцією — так мультивибір оновлюється від попереднього
  // стану, а не від того, що встиг долетіти в пропси.
  const set = (id, value) =>
    setAnswers((a) => ({ ...a, [id]: typeof value === "function" ? value(a[id]) : value }));

  const next = async () => {
    if (!last) { setStep(step + 1); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post("/quiz/profile", { answers });
      await ctx.refreshMe();
      try { localStorage.removeItem(PROFILE_DRAFT); } catch { /* нічого */ }
      setDone(true);
    } catch (e) {
      setError(e.body?.error === "already_done" ? "Анкета вже заповнена" : e.message);
    } finally {
      setBusy(false);
    }
  };

  // Обов'язкове лише головне питання кроку (без підпису — його заголовок і є
  // заголовком кроку); підпитання й текстові поля — за бажанням. Так у
  // макеті: «Далі» сіра, доки не вибрано головне, а не кожну дрібницю.
  const answered = current.questions.every((q) => {
    if (q.title || q.type === "text") return true;
    const v = answers[q.id];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });

  return (
    <div className="quiz">
      <div className="quiz-progress">
        <div className="progress"><div style={{ width: `${((step + 1) / quiz.steps.length) * 100}%` }} /></div>
        <b>{step + 1} / {quiz.steps.length}</b>
      </div>

      <div className="quiz-q">{current.title}</div>
      {current.hint && <div className="muted" style={{ fontSize: 13 }}>{current.hint}</div>}

      {current.questions.map((q) => {
        const control =
          q.type === "single" ? <Choice options={q.options} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          : q.type === "multi" ? <Choice options={q.options} multi value={answers[q.id] ?? []} onChange={(v) => set(q.id, v)} />
          : q.type === "segment" ? <Segment options={q.options} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          : q.type === "drinks" ? <DrinkGrid options={q.options} sprites={q.sprites} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          : <TextField value={answers[q.id] ?? ""} placeholder={q.placeholder} onChange={(v) => set(q.id, v)} />;
        // Питання без підпису — головне питання кроку (його заголовок уже
        // вище), з підписом — підпитання з сірим заголовком-розділом.
        return q.title
          ? <div key={q.id} className="field"><div className="sectionTitle">{q.title}</div>{control}</div>
          : <div key={q.id}>{control}</div>;
      })}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="quiz-foot">
        <span>
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />+{quiz.reward} за опитування
        </span>
        <button className="cta" disabled={busy || !answered} onClick={next}>
          {last ? (busy ? "Зберігаємо…" : "Завершити") : "Далі"}
        </button>
      </div>
    </div>
  );
}
