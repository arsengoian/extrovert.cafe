// Підтвердження покупки (власник, 01.10.2026): кнопка з ціною більше не
// списує одразу — спершу попап «що купуєш, скільки коштує, який буде
// баланс».
//
// Вигляд (власник, 02.10.2026) — як попап імені кавенятка: зверху окрема
// частина з небом і великою картинкою того, що купуєш (одяг, скринька,
// саджанець), нижче — назва з ціною, баланс і дві кнопки. Жодних пояснень
// під назвою («ляже на склад…»): попап лише підтверджує, а не розповідає.
//
// currency: "beans" — зерна; "yellow" — лише жовті монети (ринок: срібні
// гравцям не передаються); "coins" — будь-які монети, спершу срібні.
import { ConfirmSheet } from "./Popup.jsx";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

export function haveFor(currency, balances = {}) {
  if (currency === "beans") return balances.beans ?? 0;
  if (currency === "yellow") return balances.yellow ?? 0;
  return (balances.silver ?? 0) + (balances.yellow ?? 0);
}

// Іконка каже, чим саме заплатиш: лот на ринку — лише золотими, магазин —
// будь-якими, спершу срібними (тому пара монет).
export function CurrencyIcon({ currency }) {
  if (currency === "beans") return <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 15, height: 17 }} />;
  if (currency === "yellow") return <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 16, height: 17 }} />;
  return (
    <span className="coins2">
      <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 16, height: 17 }} />
      <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 16, height: 17, marginLeft: -7 }} />
    </span>
  );
}

// art — уже розміром для шапки (до ~120 px заввишки): кожен екран знає, як
// найкраще показати свій товар.
export function BuyConfirm({ art, title, price, currency, balances, busy, onCancel, onBuy, cta = "Купити" }) {
  const have = haveFor(currency, balances);
  return (
    <ConfirmSheet onCancel={onCancel}>
      <div className="buy-hero">{art}</div>
      <div className="confirm-row buy-row-title">
        <b>{title}</b>
        <strong>{fmt(price)} <CurrencyIcon currency={currency} /></strong>
      </div>
      <div className="confirm-note">
        <span>Баланс</span>
        <span>{fmt(have)} → {fmt(Math.max(0, have - price))} <CurrencyIcon currency={currency} /></span>
      </div>
      <div className="confirm-btns">
        <button onClick={onCancel}>Скасувати</button>
        <button disabled={busy} onClick={onBuy}>{busy ? "…" : cta}</button>
      </div>
    </ConfirmSheet>
  );
}
