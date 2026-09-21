// Стартовий екран — за макетом «Gamification Screens», кадри «Стартовий
// екран» і «Стартовий екран · без бонусів»: сяйво, лого, кавенятко з
// бульбашкою, бонуси за вхід і кнопки входу.
//
// Google/Apple ще не підключені (docs/services.md §3). Поки їх немає,
// обидві кнопки ведуть у девелоперський вхід — але лише локально: api
// поза local віддає на нього 404, і тоді ми чесно пишемо, що входу ще немає.
// Так екран лишається піксель у піксель як у макеті, без зайвої кнопки.
import { useState } from "react";
import { api } from "../api.js";

const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="20" height="20">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.6l7.8 6.1C12.3 13.7 17.7 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.15-3.2-.45-4.7H24v9h12.5c-.55 2.9-2.2 5.3-4.65 7l7.6 5.9c4.45-4.1 7.05-10.1 7.05-17.2Z" />
    <path fill="#FBBC05" d="M10.4 28.3a14.5 14.5 0 0 1 0-8.6l-7.8-6.1a23.6 23.6 0 0 0 0 20.8l7.8-6.1Z" />
    <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.45-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.85 2.3-6.3 0-11.7-4.2-13.6-10.1l-7.8 6.1C6.5 42.2 14.6 47.5 24 47.5Z" />
  </svg>
);

const AppleLogo = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M16.4 12.9c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.6-.9.9-1.7 1.1-2.2-2.5-1-2.4-3.7-2.4-3.8ZM14.2 5.8c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.4-.6.7-1 1.7-.9 2.7 1 .1 2-.5 2.6-1.3Z" />
  </svg>
);

const WarnIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
    <path d="M12 4.5 21 20H3l9-15.5Z" /><path d="M12 10.5v4" /><path d="M12 17.4h.01" />
  </svg>
);

// bonus — бонуси, які чекають на вхід (QR на кіоску до реєстрації). Без
// них — варіант «без бонусів»: блок із плитками просто не показуємо.
export function Start({ onSignedIn, onProblem, onSupport, bonus = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.devLogin("dev");
      await onSignedIn();
    } catch (e) {
      setError(e.status === 404 ? "Вхід через Google й Apple з'явиться незабаром" : e.message);
      setBusy(false);
    }
  };

  const [itemTop, itemBottom] = (bonus?.item?.name ?? "").split(" ");

  return (
    <div className="stage">
      <div className="start">
        <div className="start-glow" aria-hidden="true" />

        <div className="start-logo">
          <img data-logo="dark" src="/assets/logo_dark.svg" alt="extrovert.cafe" />
          <img data-logo="light" src="/assets/logo_light.svg" alt="extrovert.cafe" />
        </div>

        <div className="start-mid">
          <div className="hero">
            <img src="/assets/ui/hero_bush.png" alt="Кавенятко" />
            <div className="hero-bubble">
              <b>Твоє кавенятко</b>
              Вирости мене – я вмію розмовляти і дарувати речі в реальному світі
            </div>
          </div>

          {bonus && (
            <div className="start-bonus">
              <b>Увійди, щоб не втратити бонуси</b>
              <div className="bonus-row">
                <div className="bonus-tile">
                  <span><img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 42, height: 44, objectFit: "contain" }} /></span>
                  <b>+{bonus.coins}</b>
                </div>
                {bonus.item && (
                  <div className="bonus-tile">
                    <span className="rare"><img src={`/assets/ui/${bonus.item.icon}.png`} alt={bonus.item.name} style={{ width: 48, height: 28, objectFit: "contain" }} /></span>
                    <small>{itemTop}<br />{itemBottom}</small>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="start-btns">
            <button className="gbtn" disabled={busy} onClick={signIn}><GoogleG />Увійти через Google</button>
            <button className="gbtn apple" disabled={busy} onClick={signIn}><AppleLogo />Увійти через Apple</button>
            <button className="ghost-pill" onClick={onProblem}><WarnIcon />Повідомити про проблему</button>
            {error && <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>{error}</div>}
          </div>
        </div>

        <div className="start-foot">
          <button onClick={onSupport}>Підтримка</button>
        </div>
      </div>
    </div>
  );
}
