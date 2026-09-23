// Вхід через пошту: адреса → лист із посиланням (docs/services.md §3).
//
// Кадру в макеті немає: вхід поштою з'явився 22.09.2026 (docs/services.md
// §3). Екран зібраний із деталей кадру «Твій нікнейм» — той самий лід,
// поле й кнопка внизу, — щоб не вигадувати для нього окремої мови.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ERRORS = {
  bad_email: "Схоже, в адресі помилка",
  too_soon: "Лист щойно пішов – зачекай хвилинку",
  too_many: "Забагато листів за годину – спробуй трохи згодом",
  mail_not_configured: "Вхід через пошту ще не підключений",
  mail_failed: "Лист не відправився – спробуй ще раз",
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// next — куди повернути після входу: бонус із QR кіоска, якщо людина прийшла
// по нього. Посилання можуть відкрити й на іншому пристрої, тож шлях їде
// разом із листом, а не лежить у localStorage цього браузера.
export function EmailLogin({ next = "/" }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(null);      // { email, minutes }
  const [wait, setWait] = useState(0);         // секунд до «надіслати ще раз»
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (to) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.emailLogin(to, next);
      setSent({ email: to, minutes: r.minutes });
      setWait(r.cooldown);
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? (e.status ? e.message : "Немає зв'язку – перевір інтернет"));
      if (e.body?.retry_after) setWait(e.body.retry_after);
    } finally {
      setBusy(false);
    }
  };

  const typed = email.trim();
  const valid = EMAIL.test(typed);

  if (sent) {
    return (
      <div className="form18" style={{ gap: 16 }}>
        <div className="email-sent">
          <img src="/assets/ui/hero_bush.png" alt="" />
          <b>Лист уже летить</b>
          <div className="lead14">
            Ми надіслали лінк для входу на <b>{sent.email}</b>. Посилання діє {sent.minutes} хвилин.
          </div>
        </div>
        <div className="consent">
          <div>Пройшло 5 хвилин, а листа немає? Зазирни в «Спам» чи «Реклама». А адреса взагалі правильно введена?</div>
        </div>
        {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
        <button className="cta send start-cta" disabled={wait > 0 || busy} onClick={() => send(sent.email)}>
          {busy ? "Надсилаємо…" : wait > 0 ? `Надіслати ще раз · ${mmss(wait)}` : "Надіслати ще раз"}
        </button>
        <button className="btn" onClick={() => { setSent(null); setError(null); setEmail(sent.email); }}>
          Змінити пошту
        </button>
      </div>
    );
  }

  return (
    <form className="form18" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); if (valid && !busy) send(typed); }}>
      <div className="lead14">
        Ми надішлемо лист із посиланням для входу в 1 клік.
      </div>

      <div className="field">
        <div className="sectionTitle">Пошта</div>
        <label className="nick-field" data-tone={valid ? "ok" : "bad"}>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                 placeholder="name@gmail.com" value={email} autoFocus
                 onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        </label>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button type="submit" className="cta send start-cta" disabled={!valid || busy}>
        {busy ? "Надсилаємо…" : "Отримати посилання"}
      </button>
    </form>
  );
}
