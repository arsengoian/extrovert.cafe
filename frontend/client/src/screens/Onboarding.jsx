// Перший вхід — кадр «Підтвердження нікнейма»: згенерований нікнейм, який
// можна лишити чи змінити, і згода з умовами. Поки згоди немає, застосунок
// далі цього екрана не пускає (users.consent_at, db-schema §1).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { TopbarBack } from "../ui/TopbarBack.jsx";

const Refresh = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M20 11.5A8 8 0 1 0 12 20" /><path d="M20 5v6.5h-6" />
  </svg>
);

const Check = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M5 12.5 10 17.5 19.5 7" />
  </svg>
);

const STATUS = {
  free: ["вільний", "ok"],
  taken: ["зайнятий", "bad"],
  invalid: ["3–24 букви, цифри, _ або -", "bad"],
};

export function Onboarding({ me, onDone, onCancel }) {
  const [nickname, setNickname] = useState(me.nickname);
  const [status, setStatus] = useState("free");
  const [agreed, setAgreed] = useState(true);
  const [busy, setBusy] = useState(false);

  // Перевіряємо з затримкою, як і при переказі: «вільний» має бути видно
  // до натискання «Почати».
  useEffect(() => {
    const name = nickname.trim();
    if (name === me.nickname) { setStatus("free"); return undefined; }
    const timer = setTimeout(() => {
      api.get(`/me/nickname/check?nickname=${encodeURIComponent(name)}`)
        .then((r) => setStatus(!r.valid ? "invalid" : r.free ? "free" : "taken"))
        .catch(() => setStatus("invalid"));
    }, 300);
    return () => clearTimeout(timer);
  }, [nickname, me.nickname]);

  const regenerate = () => api.get("/me/nickname/suggest").then((r) => setNickname(r.nickname)).catch(() => {});

  const start = async () => {
    setBusy(true);
    try {
      await api.post("/me/consent", { nickname: nickname.trim() });
      await onDone();
    } catch (e) {
      setStatus(e.body?.error === "nickname_taken" ? "taken" : "invalid");
      setBusy(false);
    }
  };

  const [label, tone] = STATUS[status];
  return (
    <>
      <TopbarBack title="Твій нікнейм" onBack={onCancel} />
      <div className="stage">
        <div className="form18" style={{ gap: 16 }}>
          <div className="lead14">
            Ми згенерували унікальний нікнейм. Можеш лишити або змінити – його бачать інші користувачі.
          </div>

          <div className="field">
            <div className="sectionTitle">Нікнейм</div>
            <label className="nick-field" data-tone={tone}>
              <input value={nickname} maxLength={24} spellCheck={false}
                     onChange={(e) => setNickname(e.target.value.replace(/\s/g, ""))} />
              <span>{label}</span>
            </label>
            <button className="nick-regen" onClick={regenerate}><Refresh />Згенерувати інший</button>
          </div>

          <div className="consent">
            <button className="consent-box" role="checkbox" aria-checked={agreed} onClick={() => setAgreed(!agreed)}>
              {agreed && <Check />}
            </button>
            <div>
              Погоджуюсь на обробку та аналіз даних і приймаю{" "}
              <a className="doc-link" href="/terms" target="_blank" rel="noopener noreferrer">умови користування</a> та{" "}
              <a className="doc-link" href="/privacy-policy" target="_blank" rel="noopener noreferrer">політику приватності</a>.
            </div>
          </div>

          <button className="cta send start-cta" disabled={!agreed || status !== "free" || busy} onClick={start}>
            Почати
          </button>
        </div>
      </div>
    </>
  );
}
