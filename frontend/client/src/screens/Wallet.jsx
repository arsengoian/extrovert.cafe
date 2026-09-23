// Гаманець — за макетом «Gamification Screens», кадри «Гаманець» і
// «Гаманець · опитування в процесі»: три баланси, список способів заробити
// й три дії внизу. Історії операцій тут немає навмисно — вона на вкладці
// «Покупки», і в макеті гаманець її не показує.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PROFILE_DRAFT } from "./QuizProfile.jsx";
import { days } from "../ui/plural.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

// Чернетка анкети лежить у localStorage: сервер приймає відповіді цілком, в
// кінці, тож «крок 3 з 6» знає тільки клієнт (макет саме це й показує).
function draftStep() {
  try {
    const raw = localStorage.getItem(PROFILE_DRAFT);
    return raw ? JSON.parse(raw).step ?? 0 : 0;
  } catch {
    return 0;
  }
}

function Task({ badge, reward, title, note, action, onClick, off, children }) {
  const Row = (
    <>
      <div className="task-badge">
        <img src={badge} alt="" />
        <span>+{reward}</span>
      </div>
      <div className="task-main">
        <b>{title}</b>
        <span>{note}</span>
      </div>
      <div className={`pill ${action.kind === "primary" ? "pill-primary" : action.kind === "off" ? "pill-off" : ""}`}>
        {action.label}
      </div>
    </>
  );

  // Рядок із прогресом — колонка: сам рядок, смуга й пояснення під ними.
  if (children) {
    return (
      <div className="task-col" data-off={off || undefined}>
        <button className="task" onClick={onClick} disabled={!onClick}>{Row}</button>
        {children}
      </div>
    );
  }
  return (
    <button className="task" data-off={off || undefined} onClick={onClick} disabled={!onClick}>{Row}</button>
  );
}

export function Wallet({ ctx }) {
  const b = ctx.me?.balances ?? {};
  const [profile, setProfile] = useState(null);
  const [drink, setDrink] = useState(null);
  const [repost, setRepost] = useState(null);
  const [step, setStep] = useState(draftStep);

  useEffect(() => {
    api.get("/quiz/profile").then(setProfile).catch(() => {});
    api.get("/quiz/drink").then(setDrink).catch(() => {});
    api.get("/repost").then(setRepost).catch(() => {});
    setStep(draftStep());
  }, []);

  const steps = profile?.steps?.length ?? 6;
  const inProgress = !profile?.done && step > 0;
  const percent = Math.round((step / steps) * 100);

  return (
    <div className="stage-pad">
      <div className="bal-row">
        <div className="bal-card">
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
          <b>{fmt(b.silver)}</b>
        </div>
        <div className="bal-card">
          <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
          <b>{fmt(b.yellow)}</b>
        </div>
        <div className="bal-card">
          <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 35 }} />
          <b>{fmt(b.beans)}</b>
        </div>
      </div>

      <div className="section">
        <div className="sectionTitle">Заробляй монети безкоштовно</div>
        <div className="task-list">
          <Task
            badge="/assets/ui/coin_silver.png"
            reward={profile?.reward ?? 150}
            title="Розкажи про себе"
            note={profile?.done ? "Пройдено" : inProgress ? `Крок ${step} з ${steps} · відповіді збережено` : "Одноразово"}
            action={profile?.done
              ? { label: "Готово", kind: "off" }
              : { label: inProgress ? "Продовжити" : "Пройти", kind: "primary" }}
            onClick={profile?.done ? undefined : () => ctx.push("quizProfile")}
            off={profile?.done}
          >
            {inProgress && (
              <>
                <div className="progress-row">
                  <div className="progress"><div style={{ width: `${percent}%` }} /></div>
                  <b>{percent}%</b>
                </div>
                <div className="task-note">
                  Нарахуємо всі {profile?.reward ?? 150}{" "}
                  <img src="/assets/ui/coin_silver.png" alt="срібних монет" /> після останнього кроку.
                </div>
              </>
            )}
          </Task>

          <Task
            badge="/assets/ui/coin_silver.png"
            reward={drink?.reward ?? 40}
            title="Опитування про напій"
            note={drink?.credits ? `доступно ${drink.credits} · про будь-який напій` : "Поки недоступне"}
            action={drink?.credits ? { label: "Обрати" } : { label: "Недоступно", kind: "off" }}
            // «Обрати» — про який напій: вибір у «Покупках», на картці напою.
            onClick={drink?.credits ? () => ctx.openTab("history") : undefined}
            off={!drink?.credits}
          />

          <Task
            badge="/assets/ui/coin_silver.png"
            reward={repost?.reward ?? 80}
            title="Репост у соцмережі"
            note={repost?.limit_reached
              ? `${repost.counted} з ${repost.max} · більше не рахується`
              : repost?.days_left
                ? `${repost.counted} з ${repost.max} · ще ${days(repost.days_left)} до наступного`
                : `${repost?.counted ?? 0} з ${repost?.max ?? 5} · можна зараз`}
            action={repost && !repost.limit_reached && !repost.days_left
              ? { label: "Поділитись", kind: "primary" }
              : { label: "Пізніше", kind: "off" }}
            onClick={() => ctx.push("repost")}
            off={Boolean(repost?.limit_reached || repost?.days_left)}
          />
        </div>
      </div>

      <div className="tiles">
        <button className="tile" onClick={() => ctx.push("transfer")}>
          <span className="tile-stack">
            <img src="/assets/ui/nav_profile.png" alt="" />
            <img src="/assets/ui/coin_gold.png" alt="" />
          </span>
          <span>Переказати</span>
        </button>
        <button className="tile" onClick={() => ctx.openTab("shop")}>
          <img src="/assets/ui/beans_to_coins.png" alt="" style={{ width: 45, height: 48 }} />
          <span>Обміняти</span>
        </button>
        <button className="tile" onClick={() => ctx.push("coinPacks")}>
          <img src="/assets/ui/pack_barrel.png" alt="набір монет" style={{ width: 42, height: 48 }} />
          <span>Поповнити</span>
        </button>
      </div>
    </div>
  );
}
