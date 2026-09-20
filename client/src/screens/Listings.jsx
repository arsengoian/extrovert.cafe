// «На продажу»: усі активні лоти гравця — і одяг, і кавенята.
//
// Лічильник показів тут головне: маркет пропонує покупцям вибірку, і
// зрозуміти, чому лот не продається, можна лише за кількістю показів
// (services.md §4). Відстає він не більше ніж на хвилину.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

export function Listings({ ctx }) {
  const [listings, setListings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.get("/me/listings").then((r) => setListings(r.listings));
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!listings) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!listings.length) {
    return (
      <div className="stage-pad">
        <div className="panel muted">
          Зараз нічого не продається. Виставити річ можна з її картки на Складі, а кавенятко — з його екрана.
        </div>
      </div>
    );
  }

  const cancel = async (id) => {
    setBusy(true);
    try { await api.del(`/market/listings/${id}`); await load(); }
    catch (e) { setError(e.body?.error ?? e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="stage-pad">
      {listings.map((lot) => (
        <div key={lot.id} className="panel row" style={{ gap: 10, padding: 12 }}>
          {lot.kind === "item"
            ? <ItemIcon sprite={lot.item?.sprite_id} size={40} style={{ width: 40 }} />
            : <img src="/assets/ui/sprout.png" alt="" style={{ width: 40 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {lot.kind === "item" ? lot.item?.name : lot.plant?.name || "Кавенятко"}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              показів: {lot.impressions} · комісія {lot.commission_pct} %
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="price" style={{ fontSize: 13 }}>
              {lot.price}
              <img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
            </div>
            <button className="btn" style={{ width: "auto", height: 30, padding: "0 10px", fontSize: 12, marginTop: 4 }}
                    disabled={busy} onClick={() => cancel(lot.id)}>Зняти</button>
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12 }}>
        Дешевші лоти маркет пропонує частіше. Знята з продажу річ одразу повертається на Склад.
      </p>
    </div>
  );
}
