// «Попап · зміна нікнейма»: нове ім'я з позначкою «вільний», генерація,
// лічильник символів, поточний нікнейм і «Зберегти». Змінювати можна раз
// на 30 днів — це перевіряє api, а попап лише чесно попереджає.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmSheet } from "../ui/Popup.jsx";

const MAX = 20;
// Той самий набір, що перевіряє api (backend/api/src/routes/me.js): букви
// будь-якої абетки, цифри, підкреслення й дефіс.
const VALID = /^[\p{L}\p{N}_-]{3,20}$/u;
const ERRORS = {
  bad_nickname: "3–20 символів: букви, цифри, підкреслення й дефіс",
  nickname_taken: "Такий нікнейм уже зайнятий",
};

export function NicknameChange({ ctx }) {
  const current = ctx.me?.nickname ?? "";
  const [value, setValue] = useState(current);
  const [free, setFree] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const trimmed = value.trim();
  // Нікнейм, який не міняли, зберегти теж можна: api на такий запит просто
  // відповідає «ок» і навіть не чіпає лічильник 30 днів. Кнопка ж була
  // прибита до `free`, яке для незміненого імені лишалось null, — і
  // «Зберегти» не натискалось узагалі (скарга власника 23.09.2026).
  const unchanged = trimmed === current;
  const valid = VALID.test(trimmed);

  useEffect(() => {
    const name = value.trim();
    if (!name || name === current || !VALID.test(name)) { setFree(null); return undefined; }
    const timer = setTimeout(() => {
      api.get(`/me/nickname/check?nickname=${encodeURIComponent(name)}`).then((r) => setFree(r.valid && r.free)).catch(() => setFree(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [value, current]);

  const next = ctx.me?.nickname_change_at ? new Date(ctx.me.nickname_change_at) : null;
  const locked = next && next > new Date();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/me/nickname", { nickname: value.trim() });
      await ctx.refreshMe();
      ctx.pop();
    } catch (e) {
      setError(e.body?.error === "too_soon"
        ? `Наступна зміна – ${new Date(e.body.next).toLocaleDateString("uk-UA")}`
        : ERRORS[e.body?.error] ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmSheet onCancel={ctx.pop} closable padding="18px 16px">
      <div className="short-title" style={{ gap: 0 }}>Змінити нікнейм</div>
      <div className="short-note" style={{ lineHeight: 1.45, textWrap: "pretty" }}>
        {locked
          ? `Нікнейм бачать інші користувачі на ринку. Наступна зміна – ${next.toLocaleDateString("uk-UA")}.`
          : "Нікнейм бачать інші користувачі на ринку. Змінювати можна раз на 30 днів."}
      </div>

      <div className="field">
        <div className="profile-label">Новий нікнейм</div>
        <label className="nick-field compact" data-tone={free === false || (trimmed && !valid) ? "bad" : "ok"}>
          <input value={value} maxLength={MAX} spellCheck={false} autoComplete="off"
                 onChange={(e) => { setValue(e.target.value.replace(/\s/g, "")); setError(null); }} />
          {free && (
            <span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12.5 10 17.5 19.5 7" /></svg>
              вільний
            </span>
          )}
          {free === false && <span>зайнятий</span>}
          {/* Закоротке ім'я — це не «зайнятий»: раніше обидва випадки
              виглядали однаково, і людина шукала вільний варіант замість
              того, щоб дописати літеру. */}
          {trimmed && !valid && <span>3–20 символів</span>}
        </label>
        <div className="nick-tools">
          <button onClick={() => api.get("/me/nickname/suggest").then((r) => setValue(r.nickname.slice(0, MAX))).catch(() => {})}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 11.5A8 8 0 1 0 12 20" /><path d="M20 5v6.5h-6" /></svg>
            Згенерувати
          </button>
          <span>{value.length} / {MAX}</span>
        </div>
      </div>

      <div className="nick-current"><span>Поточний</span><b>{current}</b></div>
      {error && <div className="short-note" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="confirm-btns r14">
        <button onClick={ctx.pop}>Скасувати</button>
        <button disabled={busy || !valid || (!unchanged && (locked || !free))} onClick={save}>{busy ? "…" : "Зберегти"}</button>
      </div>
    </ConfirmSheet>
  );
}
