// «Пост у соцмережі» (до 28.09.2026 — «Репост»): посилання, чотири кроки й
// лічильник зарахованих.
// Монети нараховує сервер після першого чужого переходу — кнопка тут
// нічого не зараховує, і текст на екрані це чесно проговорює.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { days } from "../ui/plural.js";

// Тексти — веселіші (власник, 27.09.2026), але правила ті самі, що рахує
// сервер: публічний пост, монети після першого переходу, пауза між
// зарахованими й ліміт за акаунт — числа приходять із сервера.
const steps = (s) => [
  ["Хапай своє посилання",
   "Воно особисте й одне на пост: за ним ми впізнаємо, що гості прийшли саме від тебе. Щойно пост зарахуємо, тут з'явиться нове посилання для наступного."],
  ["Похизуйся в соцмережах",
   "Сторіс, пост чи рілс – Instagram, Threads, TikTok, X, будь-що публічне. Закриті чати не рахуються: там тебе бачить хіба що мама."],
  ["Чекай на першого гостя",
   "Щойно хтось відкриє посилання, монети прилетять самі. Зазвичай це кілька хвилин – якраз устигнеш допити каву."],
  [`Наступний – через ${days(s.min_days_between)}`,
   `Між зарахованими постами мають минути ${days(s.min_days_between)}, а всього за акаунт рахуємо ${s.max}. Не спам, а сезонний хіт.`],
];

// Підказки, про що писати: порожній пост із самим посиланням не клікають.
const IDEAS = [
  "Покажи своє кавенятко – особливо якщо воно вже в капелюсі чи з бобами",
  "Розкажи, яку каву береш і біля якого автомата тебе ловити",
  "Похвалися рідкісною річчю, що випала зі щасливої скриньки",
  "Поклич друзів: кавенятко можна подарувати, а монети – переказати",
  "Або просто: «Кожна моя кава годує кущ, який росте в телефоні. Я в ділі»",
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
    try { await navigator.share({ url: state.link, text: "Я вирощую кавенятко в extrovert.cafe: кожна кава його підгодовує. Приєднуйся!" }); }
    catch { /* користувач закрив шит — це не помилка */ }
  };

  const hint = state.limit_reached
    ? "Це всі пости, які зараховуємо за акаунт. Дякуємо!"
    : state.days_left
      ? `Посилання для наступного посту з'явиться за ${days(state.days_left)}`
      : "Посилання активне: перший чужий перехід зарахує монети";

  return (
    <div className="quiz" style={{ gap: 16 }}>
      <div className="repost-head">
        <div className="badge-coin">
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
          <span>+{state.reward}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Зараховано {state.counted} з {state.max}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>
        </div>
      </div>

      <ol className="steps" style={{ margin: 0 }}>
        {steps(state).map(([title, text], i) => (
          <li key={title}>
            <span className="steps-num">{i + 1}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 3, textWrap: "pretty" }}>{text}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="field">
        <div className="sectionTitle">Про що написати</div>
        <div className="pl-bullets">
          {IDEAS.map((idea) => <div key={idea}><i /><span>{idea}</span></div>)}
        </div>
      </div>

      {state.link && (
        <div className="field">
          <div className="sectionTitle">Посилання для посту {state.counted + 1} з {state.max}</div>
          <div className="row" style={{ gap: 8 }}>
            <div className="link-field">{state.link.replace(/^https?:\/\//, "")}</div>
            <button className="icon-sq" onClick={copy} aria-label="Скопіювати посилання">
              {copied ? "✓" : <CopyIcon />}
            </button>
          </div>
        </div>
      )}

      {state.link && <button className="cta wide" style={{ marginTop: "auto", height: 52, gap: 8 }} onClick={share}>
        <ShareIcon />
        Поділитися
      </button>}
    </div>
  );
}
