// «Переказати монети»: нікнейм, сума, підтвердження.
//
// Переказ незворотний, тому на екрані двічі сказано те саме різними
// словами — і попередження про шахраїв стоїть не внизу дрібним шрифтом, а
// в тому ж блоці, де кнопка (design «Переказ монет»).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";

const QUICK = [100, 200, 500];

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n);

export function TransferDone({ done, onClose }) {
  return (
    <ResultPopup
      art={<img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 62, height: 65 }} />}
      title="Переказ виконано"
      onClose={onClose}
    >
      <div className="result-sum">
        <img src="/assets/ui/coin_gold.png" alt="золотих монет" />{fmt(done.amount)}
        <small>→ {done.to}</small>
      </div>
      <div className="result-note">
        <span>Твій баланс: <b>{fmt(done.left)}</b>. Операція вже в історії гаманця.</span>
      </div>
    </ResultPopup>
  );
}

export function Transfer({ ctx }) {
  const [nickname, setNickname] = useState("");
  const [found, setFound] = useState(null);
  const [amount, setAmount] = useState("200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const balance = ctx.me?.balances?.yellow ?? 0;
  const value = Math.trunc(Number(amount) || 0);

  // Перевіряємо нікнейм із затримкою: переказ не туди — найдорожча
  // помилка на цьому екрані, тож підтвердження має бути видно до кнопки.
  useEffect(() => {
    const name = nickname.trim();
    if (name.length < 3) { setFound(null); return undefined; }
    const timer = setTimeout(() => {
      api.get(`/me/transfer/check?nickname=${encodeURIComponent(name)}`).then(setFound).catch(() => setFound(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [nickname]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/me/transfer", { nickname: nickname.trim(), amount: value });
      await ctx.refreshMe();
      // Як у кадрі «Попап · переказ виконано»: назад у гаманець, попап над ним.
      ctx.pop();
      ctx.notify(<TransferDone done={r} onClose={() => ctx.notify(null)} />);
    } catch (e) {
      const code = e.body?.error;
      setError(code === "no_such_user" ? "Такого нікнейма немає"
        : code === "self_transfer" ? "Це ти сам"
        : code === "not_enough" ? "Не вистачає жовтих монет"
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = found?.found && !found.self && value > 0 && value <= balance;

  return (
    <div className="quiz">
      <div className="field">
        <div className="sectionTitle">Кому</div>
        <div className="input-row">
          <input value={nickname} placeholder="нікнейм"
                 onChange={(e) => setNickname(e.target.value.replace(/\s/g, "").slice(0, 24))} />
          {found?.found && !found.self && <span style={{ color: "#3FBF6F" }}>знайдено</span>}
          {found?.self && <span className="muted">це ти</span>}
          {found && !found.found && <span className="muted">немає</span>}
        </div>
      </div>

      <div className="field">
        <div className="sectionTitle">Скільки</div>
        <div className="input-row amount-row">
          <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
          <input inputMode="numeric" value={amount}
                 onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <span>з {fmt(balance)}</span>
        </div>
        <div className="quick">
          {QUICK.map((n) => (
            <button key={n} aria-pressed={value === n} onClick={() => setAmount(String(n))}>{n}</button>
          ))}
          <button aria-pressed={value === balance && balance > 0} onClick={() => setAmount(String(balance))}>усе</button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, textWrap: "pretty" }}>
        Після підтвердження переказ скасувати неможливо. Переказуй лише гравцям, яких знаєш особисто.
      </div>

      <div className="warn">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#FE810B" strokeWidth="2" strokeLinecap="round">
          <path d="M12 4.5 21 20H3l9-15.5Z" /><path d="M12 10.5v4" /><path d="M12 17.4h.01" />
        </svg>
        <div>Співробітники extrovert.cafe ніколи не просять переказати монети. Якщо просять – це шахраї.</div>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" style={{ marginTop: "auto", height: 52, gap: 7 }} disabled={!ready || busy} onClick={send}>
        {busy ? "Переказуємо…" : <>Переказати {fmt(value)} <img src="/assets/ui/coin_gold.png" alt="золотих монет" style={{ width: 20, height: 21 }} /></>}
      </button>

    </div>
  );
}
