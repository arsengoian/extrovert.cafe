// «Переказати монети»: нікнейм, сума, підтвердження.
//
// Переказ незворотний, тому на екрані двічі сказано те саме різними
// словами — і попередження про шахраїв стоїть не внизу дрібним шрифтом, а
// в тому ж блоці, де кнопка (design «Переказ монет»).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { coins as coinsWord } from "../ui/plural.js";

const QUICK = [100, 200, 500];

export function Transfer({ ctx }) {
  const [nickname, setNickname] = useState("");
  const [found, setFound] = useState(null);
  const [amount, setAmount] = useState("200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

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

  if (done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 54, margin: "6px auto 10px" }} />
          <div className="h2">Переказано {coinsWord(done.amount)}</div>
          <p className="muted">Гравець {done.to} уже бачить їх у себе. Лишилось {coinsWord(done.left)}.</p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/me/transfer", { nickname: nickname.trim(), amount: value });
      await ctx.refreshMe();
      setDone(r);
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
    <div className="stage-pad">
      <div className="sectionTitle">Кому</div>
      <div className="panel row" style={{ gap: 10 }}>
        <input
          className="price-input" style={{ fontSize: 15 }}
          value={nickname} placeholder="нікнейм"
          onChange={(e) => setNickname(e.target.value.replace(/\s/g, "").slice(0, 24))}
        />
        {found?.found && !found.self && <span style={{ fontSize: 12, fontWeight: 700, color: "#3FBF6F" }}>знайдено</span>}
        {found?.self && <span className="muted" style={{ fontSize: 12 }}>це ти</span>}
        {found && !found.found && <span className="muted" style={{ fontSize: 12 }}>немає</span>}
      </div>

      <div className="sectionTitle">Скільки</div>
      <div className="panel row-between" style={{ borderColor: "var(--accent)" }}>
        <span className="row" style={{ gap: 9 }}>
          <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 26 }} />
          <input className="price-input" style={{ border: 0, background: "transparent", padding: 0, height: 32 }}
                 inputMode="numeric" value={amount}
                 onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </span>
        <span className="muted" style={{ fontSize: 12 }}>з {balance}</span>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        {QUICK.map((n) => (
          <button key={n} className="btn" style={{ flex: 1, height: 36, fontSize: 12 }}
                  onClick={() => setAmount(String(n))}>{n}</button>
        ))}
        <button className="btn" style={{ flex: 1, height: 36, fontSize: 12 }}
                onClick={() => setAmount(String(balance))}>усе</button>
      </div>

      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Після підтвердження переказ скасувати неможливо. Переказуй лише гравцям, яких знаєш особисто.
      </p>
      <div className="panel row" style={{ gap: 10, background: "rgba(254,129,11,.14)", borderColor: "rgba(254,129,11,.5)" }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: "#FFB061" }}>
          Співробітники extrovert.cafe ніколи не просять переказати монети. Якщо просять — це шахраї.
        </span>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!ready || busy} onClick={send}>
        {busy ? "Переказуємо…" : `Переказати ${coinsWord(value)}`}
      </button>
    </div>
  );
}
