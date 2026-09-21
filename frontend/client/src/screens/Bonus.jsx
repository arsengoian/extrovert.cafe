// Редім бонусу за чек: екран, на який веде QR з кіоска після покупки.
//
// Бонус прив'язаний до чека, а не до гравця, тому забрати його може будь-хто,
// хто першим відкрив посилання — рівно як домовлено в дизайні: QR горить на
// екрані точки дві хвилини й зникає.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { coins as coinsWord } from "../ui/plural.js";

const ERRORS = {
  already_taken: "Цей бонус уже забрали",
  already_yours: "Ти вже забрав цей бонус",
  expired: "Бонус згорів — QR діє дві хвилини",
  no_such_bonus: "Такого бонусу немає",
};

export function Bonus({ token, ctx }) {
  const [state, setState] = useState(null);
  const [claimed, setClaimed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/me/bonus/${encodeURIComponent(token)}`)
      .then(setState)
      .catch((e) => setError(ERRORS[e.body?.error] ?? e.body?.error ?? e.message));
  }, [token]);

  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/me/bonus/${encodeURIComponent(token)}`);
      await ctx.refreshMe();
      setClaimed(r);
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !state) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!state) return <div className="stage-pad"><div className="skeleton" /></div>;

  const coins = claimed?.coins ?? state.coins;
  const items = claimed?.items ?? state.items ?? [];

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 64, margin: "6px auto 10px" }} />
        <div className="h2">{claimed ? "Бонус зарахований" : "Бонус за покупку"}</div>
        <div style={{ fontSize: 30, fontWeight: 900 }}>+{coins}</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {state.point}
          {state.fiscal_date ? ` · ${new Date(state.fiscal_date).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
          {state.total_uah ? ` · ${state.total_uah} ₴` : ""}
        </p>
      </div>

      {items.length > 0 && (
        <div className="panel">
          <div className="muted" style={{ fontSize: 12 }}>З покупкою випало</div>
          {items.map((code) => <div key={code} style={{ fontWeight: 700 }}>{code}</div>)}
        </div>
      )}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      {claimed ? (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            {coinsWord(coins)} зараховано до акаунту {ctx.me?.nickname}.
          </p>
          <button className="btn btn-primary" onClick={() => ctx.openTab("plant")}>До кавенятка</button>
        </>
      ) : (
        <button className="btn btn-primary" disabled={busy || state.expired || state.status === "redeemed"} onClick={take}>
          {state.status === "redeemed" ? "Уже забрано" : state.expired ? "Бонус згорів" : busy ? "Забираємо…" : "Забрати"}
        </button>
      )}
    </div>
  );
}
