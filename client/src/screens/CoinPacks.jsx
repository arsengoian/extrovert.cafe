// «Купити монети»: пачки за гривні.
//
// Платіжного провайдера ще немає. Замість того щоб малювати кнопку, яка
// нічого не робить, екран прямо каже, що оплата поки лише тестова, і в
// проді її не буде взагалі (api віддасть 501).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { coins as coinsWord } from "../ui/plural.js";

export function CoinPacks({ ctx }) {
  const [packs, setPacks] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/shop/coin-packs").then((r) => setPacks(r.packs)).catch(() => setPacks([])); }, []);

  if (!packs) return <div className="stage-pad"><div className="skeleton" /></div>;

  const pay = async (pack) => {
    setBusy(pack.code);
    setError(null);
    try {
      const r = await api.post(`/shop/coin-packs/${pack.code}/pay`);
      await ctx.refreshMe();
      setDone(r);
    } catch (e) {
      setError(e.body?.error === "payments_not_connected"
        ? "Оплата карткою ще не підключена — скоро."
        : e.body?.error ?? e.message);
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 54, margin: "6px auto 10px" }} />
          <div className="h2">+{coinsWord(done.coins)}</div>
          <p className="muted">
            {done.test ? "Тестова оплата: у проді тут буде картка." : `Оплачено ${done.uah} ₴.`}
          </p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  // Найвигідніша пачка — та, де монета коштує найменше; її й позначаємо,
  // щоб не рахувати курс в умі на касі.
  const best = packs.reduce((b, p) => (!b || p.price_uah / p.coins < b.price_uah / b.coins ? p : b), null);

  return (
    <div className="stage-pad">
      {packs.map((pack) => (
        <button key={pack.code} className="panel row" style={{ gap: 12, width: "100%", textAlign: "left" }}
                disabled={busy} onClick={() => pay(pack)}>
          <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 38 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>{pack.coins} монет</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {(pack.price_uah / pack.coins).toFixed(2)} ₴ за монету
              {best?.code === pack.code ? " · найвигідніше" : ""}
            </div>
          </div>
          <span className="price">{pack.price_uah} ₴</span>
        </button>
      ))}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
        Куплені монети — звичайні жовті: ними платять за все, що коштує монети, і їх можна переказати.
        Зерна за гривні не продаються принципово.
      </p>
    </div>
  );
}
