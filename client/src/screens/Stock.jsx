// Склад: інвентар одягу, згрупований за наборами, з лічильником дублів.
import { useEffect, useState } from "react";
import { api } from "../api.js";

export function Stock({ ctx }) {
  const [items, setItems] = useState(null);

  useEffect(() => { api.get("/me/items").then((r) => setItems(r.items)).catch(() => setItems([])); }, []);

  if (!items) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!items.length) {
    return (
      <div className="stage-pad">
        <div className="panel muted">
          Склад порожній. Одяг падає зі скриньок, трапляється з покупкою кави або купується в Магазині.
        </div>
      </div>
    );
  }

  const byCollection = items.reduce((acc, it) => {
    (acc[it.collection ?? "Інше"] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div className="stage-pad">
      {Object.entries(byCollection).map(([collection, list]) => (
        <div key={collection}>
          <div className="sectionTitle">{collection}</div>
          <div className="grid2">
            {list.map((it) => (
              <button key={it.code} className="panel" style={{ textAlign: "left", position: "relative" }}
                      onClick={() => ctx.push("itemCard", { item: it, owned: true })}>
                <img src={`/assets/ui/${it.sprite_id}.png`} alt="" style={{ width: "100%", height: 70, objectFit: "contain" }}
                     onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{it.name}</div>
                <div className={`tag tag-${it.tier}`} style={{ marginTop: 4 }}>{it.slot}</div>
                {it.owned > 1 && (
                  <span className="nav-badge" style={{ position: "absolute", top: 8, right: 8, left: "auto", margin: 0 }}>×{it.owned}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
