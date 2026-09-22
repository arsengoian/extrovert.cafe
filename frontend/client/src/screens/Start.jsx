// Стартовий екран — за макетом «Gamification Screens», кадри «Стартовий
// екран» і «Стартовий екран · без бонусів»: сяйво, лого, кавенятко з
// бульбашкою, бонуси за вхід і кнопки входу.
//
// Входів два: Google і пошта (docs/services.md §3). У макеті під Google
// стоїть інша кнопка входу — пошта зайняла її місце тим самим стилем.
// Google ще не підключений: у dev-збірці він веде в девелоперський вхід, у
// проді чесно каже, що його ще немає.
import { useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="20" height="20">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.6l7.8 6.1C12.3 13.7 17.7 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.15-3.2-.45-4.7H24v9h12.5c-.55 2.9-2.2 5.3-4.65 7l7.6 5.9c4.45-4.1 7.05-10.1 7.05-17.2Z" />
    <path fill="#FBBC05" d="M10.4 28.3a14.5 14.5 0 0 1 0-8.6l-7.8-6.1a23.6 23.6 0 0 0 0 20.8l7.8-6.1Z" />
    <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.45-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.85 2.3-6.3 0-11.7-4.2-13.6-10.1l-7.8 6.1C6.5 42.2 14.6 47.5 24 47.5Z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m4 7.5 8 6 8-6" />
  </svg>
);

const WarnIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
    <path d="M12 4.5 21 20H3l9-15.5Z" /><path d="M12 10.5v4" /><path d="M12 17.4h.01" />
  </svg>
);

// bonus — бонуси, які чекають на вхід (QR на кіоску до реєстрації). Без
// них — варіант «без бонусів»: блок із плитками просто не показуємо.
export function Start({ onSignedIn, onEmail, onProblem, onSupport, bonus = null, note = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const google = async () => {
    if (!api.devLogin) {
      setError("Вхід через Google з'явиться незабаром – поки що заходь через пошту");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.devLogin("dev");
      await onSignedIn();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

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
                    <span className={`tier-${bonus.item.tier}`}>
                      <ItemIcon sprite={bonus.item.sprite_id} size={48} alt={bonus.item.name} style={{ width: 48 }} />
                    </span>
                    <small>{bonus.item.name}{bonus.item.collection && <><br />«{bonus.item.collection}»</>}</small>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="start-btns">
            <button className="gbtn" disabled={busy} onClick={google}><GoogleG />Увійти через Google</button>
            <button className="gbtn" disabled={busy} onClick={onEmail}><MailIcon />Увійти через пошту</button>
            <button className="ghost-pill" onClick={onProblem}><WarnIcon />Повідомити про проблему</button>
            {(error || note) && <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>{error || note}</div>}
          </div>
        </div>

        <div className="start-foot">
          <button onClick={onSupport}>Підтримка</button>
        </div>
      </div>
    </div>
  );
}
