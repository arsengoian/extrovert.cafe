// «Репост у соцмережі»: посилання, чотири кроки й лічильник зарахованих.
// Монети нараховує сервер після першого чужого переходу — кнопка тут
// нічого не зараховує, і текст на екрані це чесно проговорює.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const STEPS = [
  ["Скопіюй своє посилання",
   "Воно унікальне: саме за ним ми бачимо, що перехід прийшов від тебе."],
  ["Поділись у сторіс або пості",
   "Instagram, Threads, TikTok, X – будь-яка публічна публікація, не в закритому чаті."],
  ["Дочекайся першого переходу",
   "Монети падають після того, як хтось відкриє твоє посилання. Зазвичай це кілька хвилин."],
  ["Наступний – за 10 днів",
   "Між зарахованими репостами має пройти 10 днів. Усього за акаунт зараховуємо 5 репостів."],
];

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M5 14v5h14v-5" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" />
    <path d="M15.5 5.5H6.2A1.7 1.7 0 0 0 4.5 7.2v9.3" />
  </svg>
);

export function Repost() {
  const [state, setState] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.get("/repost").then(setState).catch(() => setState({ error: true })); }, []);

  if (!state) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (state.error) return <div className="stage-pad"><div className="panel">Не вдалось отримати посилання. Спробуй пізніше.</div></div>;

  const copy = async () => {
    try { await navigator.clipboard.writeText(state.link); }
    catch { return; }                                 // без дозволу на буфер — просто нічого
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Нативний шер є не всюди (десктоп, вбудовані вебв'ю) — там лишається копія.
  const share = async () => {
    if (!navigator.share) return copy();
    try { await navigator.share({ url: state.link, text: "Моє кавенятко росте в extrovert.cafe" }); }
    catch { /* користувач закрив шит — це не помилка */ }
  };

  const hint = state.limit_reached
    ? "Це всі репости, які зараховуємо за акаунт. Дякуємо!"
    : state.days_left
      ? `Наступний репост можна зарахувати за ${state.days_left} ${state.days_left === 1 ? "день" : "днів"}`
      : "Посилання активне: наступний перехід зарахує монети";

  return (
    <div className="stage-pad">
      <div className="panel row" style={{ gap: 13, borderColor: "var(--accent)" }}>
        <div className="badge-coin">
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
          <span>+{state.reward}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Зараховано {state.counted} з {state.max}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>
        </div>
      </div>

      <ol className="steps">
        {STEPS.map(([title, text], i) => (
          <li key={title}>
            <span className="steps-num">{i + 1}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 3 }}>{text}</div>
            </div>
          </li>
        ))}
      </ol>

      {state.link && (
        <>
          <div className="sectionTitle">Твоє посилання</div>
          <div className="row" style={{ gap: 8 }}>
            <div className="panel link-box">{state.link.replace(/^https?:\/\//, "")}</div>
            <button className="btn btn-icon" onClick={copy} aria-label="Скопіювати посилання"><CopyIcon /></button>
          </div>
          {copied && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Скопійовано</div>}
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={share}><ShareIcon />Поділитися</button>
        </>
      )}
    </div>
  );
}
