// «Весь одяг»: каталог усіх тірів, ціна рахується з тіру (economy §5.1).
import { useEffect, useState } from "react";
import { api } from "../api.js";

const TIERS = [
  { id: null, label: "Усі" },
  { id: "common", label: "Звичайні" },
  { id: "uncommon", label: "Незвичайні" },
  { id: "rare", label: "Рідкісні" },
  { id: "epic", label: "Епічні" },
];

export function Catalog({ ctx }) {
  const [tier, setTier] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/catalog/items${tier ? `?tier=${tier}` : ""}`).then(setData).catch(() => setData({ items: [] }));
  }, [tier]);

  return (
    <div className="stage-pad">
      <div className="row" style={{ gap: 6, overflowX: "auto", paddingBottom: 6 }}>
        {TIERS.map((t) => (
          <button key={t.label} className="tag"
                  style={{ padding: "6px 12px", background: tier === t.id ? "var(--grad)" : "var(--panel2)", color: tier === t.id ? "var(--accent-ink)" : "var(--muted)" }}
                  onClick={() => setTier(t.id)}>{t.label}</button>
        ))}
      </div>

      {!data && <div className="skeleton" />}
      <div className="grid2" style={{ marginTop: 10 }}>
        {data?.items.map((item) => (
          <button key={item.code} className="panel" style={{ textAlign: "left" }} onClick={() => ctx.push("itemCard", { item })}>
            <img src={`/assets/ui/${item.sprite_id}.png`} alt="" style={{ width: "100%", height: 74, objectFit: "contain" }}
                 onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{item.name}</div>
            <div className={`tag tag-${item.tier}`} style={{ marginTop: 4 }}>{item.collection}</div>
            <div className="price" style={{ marginTop: 6 }}>{item.price_coins}<img src="/assets/ui/coin_gold.png" alt="монет" /></div>
          </button>
        ))}
      </div>
    </div>
  );
}
