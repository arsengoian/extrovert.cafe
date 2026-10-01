// Підтвердження покупки (власник, 01.10.2026): кнопка з ціною більше не
// списує одразу — спершу попап «що купуєш, скільки коштує, який буде
// баланс». Вигляд — як у підтвердження наборів монет (screens/CoinPacks.jsx).
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

export function CurrencyIcon({ currency }) {
  return currency === "beans"
    ? <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 15, height: 17 }} />
    : <img src="/assets/ui/coin_gold.png" alt="монети" style={{ width: 16, height: 17 }} />;
}

export function BuyConfirm({ art, title, subtitle, price, currency, balances, busy, onCancel, onBuy, cta, after }) {
  const have = haveFor(currency, balances);
  return (
    <ConfirmSheet onCancel={onCancel}>
      <div className="confirm-row">
        {art}
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{title}</b>
          {subtitle && <span className="muted" style={{ fontSize: 12.5 }}>{subtitle}</span>}
        </div>
        <strong style={{ display: "flex", alignItems: "center", gap: 4 }}>{fmt(price)} <CurrencyIcon currency={currency} /></strong>
      </div>
      <div className="confirm-note">
        <span>Баланс після покупки</span>
        <span>{fmt(have)} → {fmt(Math.max(0, have - price))} <CurrencyIcon currency={currency} /></span>
      </div>
      {after}
      <div className="confirm-btns">
        <button onClick={onCancel}>Скасувати</button>
        <button disabled={busy} onClick={onBuy}>{busy ? "…" : cta ?? `Купити за ${fmt(price)}`}</button>
      </div>
    </ConfirmSheet>
  );
}
