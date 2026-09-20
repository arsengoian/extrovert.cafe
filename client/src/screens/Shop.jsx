// Магазин: два розділи — за монети й за кавові боби (gamification_ui.md).
import { useEffect, useState } from "react";
import { api } from "../api.js";

const coinIcon = { yellow: "/assets/ui/coin_gold.png", beans: "/assets/ui/bean.png" };

function Price({ value, currency, gives }) {
  if (value === null || value === undefined) return <span className="muted">ціна уточнюється</span>;
  return (
    <span className="price">
      {value}
      <img src={coinIcon[currency]} alt={currency === "beans" ? "зерен" : "монет"} />
      {gives ? <span className="muted" style={{ fontWeight: 400 }}>→ {gives}</span> : null}
    </span>
  );
}

function Card({ item, onOpen }) {
  return (
    <button className="panel" style={{ display: "block", width: "100%", textAlign: "left" }} onClick={() => onOpen(item)}>
      <div className="row">
        <img src={`/${item.icon}`} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{item.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>{item.subtitle}</div>
        </div>
        <Price value={item.price ?? item.price_from} currency={item.currency} gives={item.gives_coins} />
      </div>
    </button>
  );
}

export function Shop({ ctx }) {
  const [shop, setShop] = useState(null);
  const [mode, setMode] = useState("coins");

  useEffect(() => { api.get("/shop").then(setShop).catch(() => setShop({ coins: [], beans: [] })); }, []);

  const open = (item) => {
    if (item.code === "clothing") return ctx.push("catalog");
    // Скринька має власний екран — із шансами й анімацією; решта товарів
    // відкривається спільним прев'ю.
    ctx.push(item.kind === "crate" ? "shopItem" : "shopProduct", { item });
  };

  const tabStyle = (on) => ({ height: 40, background: on ? "var(--grad)" : "var(--panel)", color: on ? "var(--accent-ink)" : "var(--ink)", border: on ? 0 : "1px solid var(--line)" });

  return (
    <div className="stage-pad">
      <button className="btn" style={{ marginBottom: 12 }} onClick={() => ctx.push("orders")}>
        Мої замовлення
        {ctx.me?.badges?.orders ? <span className="nav-badge" style={{ position: "static" }}>{ctx.me.badges.orders}</span> : null}
      </button>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn" style={tabStyle(mode === "coins")} onClick={() => setMode("coins")}>За монети</button>
        <button className="btn" style={tabStyle(mode === "beans")} onClick={() => setMode("beans")}>За зерна</button>
      </div>

      {!shop && <div className="skeleton" />}
      {shop && (mode === "coins" ? shop.coins : shop.beans).map((item) => (
        <Card key={item.code} item={item} onOpen={open} />
      ))}
    </div>
  );
}
