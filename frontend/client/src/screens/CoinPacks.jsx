// «Купити монети»: пачки за гривні.
//
// Оплата — mono pay: api створює рахунок, ми переходимо на сторінку банку
// й повертаємось на /?pay=1. Якщо MONO_TOKEN не налаштований, у local
// рахунок «оплачується» одразу, а в проді роут відповідає 501 — кнопки,
// яка мовчки нічого не робить, тут немає.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { coins as coinsWord } from "../ui/plural.js";

export const PENDING_KEY = "extrovert.pending_invoice";

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
      const r = await api.post(`/shop/coin-packs/${pack.code}/invoice`);
      if (r.page_url) {
        // Повертаючись із банку, застосунок має знати, чий статус питати:
        // у самій адресі повернення id платежу не передаємо.
        localStorage.setItem(PENDING_KEY, r.invoice_id);
        window.location.href = r.page_url;
        return;
      }
      // Тестова оплата (local): монети вже нараховані.
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

  // Картинка пачки й знижка — з макета: чим більша пачка, тим «врожайніша»
  // картинка. Знижку рахуємо від ціни монети в найменшій пачці, а не
  // вписуємо руками — інакше вона розійдеться з цінами першою ж правкою.
  const ART = {
    sprout: { src: "pack_stacks", w: 36, h: 39 },
    bush: { src: "pack_heap", w: 58, h: 43 },
    bloom: { src: "pack_crate", w: 59, h: 52 },
    harvest: { src: "pack_barrel", w: 52, h: 60 },
  };
  const base = Math.max(...packs.map((p) => p.price_uah / p.coins));
  const perCoin = (p) => (p.price_uah / p.coins).toFixed(2).replace(".", ",");
  const discount = (p) => Math.round((1 - p.price_uah / p.coins / base) * 100);
  const best = packs.find((p) => p.best) ??
    packs.reduce((b, p) => (!b || p.price_uah / p.coins < b.price_uah / b.coins ? p : b), null);
  const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n);

  return (
    <div className="stage-pad">
      <div className="lead">Монети зараховуються одразу після оплати.</div>

      {packs.map((pack) => {
        const art = ART[pack.code] ?? ART.sprout;
        const off = discount(pack);
        const isBest = best?.code === pack.code;
        return (
          <button key={pack.code} className={`pack${isBest ? " best" : ""}`} disabled={Boolean(busy)} onClick={() => pay(pack)}>
            {isBest && <span className="pack-flag">Найкраща ціна{off > 0 ? ` · −${off}%` : ""}</span>}
            <img src={`/assets/ui/${art.src}.png`} alt="набір монет" style={{ width: art.w, height: art.h }} />
            <span className="pack-main">
              <span className="pack-name">
                {pack.label ?? `${pack.coins} монет`}
                {!isBest && off > 0 && <i>−{off}%</i>}
              </span>
              <span className="pack-coins">
                {fmt(pack.coins)} <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
              </span>
            </span>
            <span className="pack-price">
              <b>{busy === pack.code ? "…" : `${fmt(pack.price_uah)} ₴`}</b>
              <small>{perCoin(pack)} ₴ / монета</small>
            </span>
          </button>
        );
      })}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
    </div>
  );
}
