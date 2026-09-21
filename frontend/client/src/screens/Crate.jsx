// Прев'ю скриньки й результат відкриття. Шанси показуємо до покупки —
// це вимога економіки (розділ 0, етична рекомендація), а не прикраса.
import { useState } from "react";
import { api } from "../api.js";
import { renderMarkdown } from "../ui/markdown.jsx";

const TIER_LABEL = { common: "Звичайний", uncommon: "Незвичайний", rare: "Рідкісний", epic: "Епічний" };

export function CratePreview({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const odds = item?.odds ?? {};
  const [min, max] = item?.coins_range ?? [5, 25];

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post("/shop/crate/open");
      await ctx.refreshMe();
      ctx.push("crateResult", { result });
    } catch (e) {
      setError(e.status === 409 ? "Не вистачає монет" : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <img src="/assets/ui/crate.png" alt="" style={{ width: 150, margin: "0 auto" }} />
        <div className="h2" style={{ marginTop: 10 }}>Щаслива скринька</div>
        <p className="muted" style={{ margin: 0 }}>
          Усередині завжди двоє: предмет одягу й монети від {min} до {max}.
        </p>
      </div>

      <div className="panel">
        <div className="h2">Шанси</div>
        {Object.entries(odds).map(([tier, p]) => (
          <div key={tier} className="row-between" style={{ padding: "4px 0" }}>
            <span className={`tag tag-${tier}`}>{TIER_LABEL[tier] ?? tier}</span>
            <span style={{ fontWeight: 700 }}>{Math.round(p * 100)}%</span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Дубль теж буває — його можна продати на P2P-маркеті.
        </p>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <button className="btn btn-primary" disabled={busy} onClick={open}>
          {busy ? "Відкриваємо…" : `Відкрити за ${item?.price ?? 85} монет`}
        </button>
        <button className="btn" disabled title="Оплата картою буде разом із mono pay">
          {item?.price_uah ? `Купити за ${item.price_uah} ₴` : "Купити за гривні — ціна уточнюється"}
        </button>
      </div>
    </div>
  );
}

export function CrateResult({ result, ctx }) {
  if (!result) return null;
  const { item, coins, was_duplicate: dup, tier } = result;

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center", position: "relative" }}>
        <img src="/assets/sprites/crate_parts/crate_glow.png" alt=""
             style={{ position: "absolute", inset: 0, width: "100%", opacity: .5 }} />
        <img src={`/assets/ui/${item.sprite_id}.png`} alt="" style={{ width: 140, height: 140, objectFit: "contain", margin: "0 auto", position: "relative" }}
             onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        <div className="h2" style={{ marginTop: 8 }}>{item.name}</div>
        <div className="row" style={{ justifyContent: "center", gap: 6 }}>
          <span className={`tag tag-${tier}`}>{TIER_LABEL[tier] ?? tier}</span>
          {item.collection ? <span className="tag">{item.collection}</span> : null}
        </div>
        {dup && <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>У тебе такий уже є — дубль можна продати на маркеті.</p>}
      </div>

      <div className="panel row-between">
        <span>І монети на додачу</span>
        <span className="price">+{coins}<img src="/assets/ui/coin_gold.png" alt="монет" /></span>
      </div>

      {item.description_md ? <div className="panel">{renderMarkdown(item.description_md)}</div> : null}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {dup && <button className="btn" onClick={() => ctx.push("sellItem", { item })}>Продати дубль на P2P</button>}
        <button className="btn btn-primary" onClick={() => ctx.openTab("stock")}>На склад</button>
      </div>
    </div>
  );
}
