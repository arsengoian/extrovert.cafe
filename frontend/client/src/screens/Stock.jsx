// Склад — за макетом «Gamification Screens», кадр «Склад»: заголовок із
// лічильником, картка нерозпакованих скриньок, далі колекції сіткою.
// Клітинка показує саму річ, а не картку з назвою: у макеті назви немає,
// бо п'ять слотів комплекту впізнаються за силуетом.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

export function Stock({ ctx }) {
  const [items, setItems] = useState(null);
  const [crates, setCrates] = useState(0);
  // Скільки всього речей у колекції — щоб показати «3 з 5», як у макеті.
  const [sizes, setSizes] = useState({});

  useEffect(() => {
    api.get("/me/items").then((r) => { setItems(r.items); setCrates(r.crates ?? 0); }).catch(() => setItems([]));
    api.get("/catalog/collections")
      .then((r) => setSizes(Object.fromEntries((r.collections ?? []).map((c) => [c.collection, c.items]))))
      .catch(() => {});
  }, []);

  if (!items) return <div className="stage-pad"><div className="skeleton" /></div>;

  const byCollection = items.reduce((acc, it) => {
    (acc[it.collection ?? "Інше"] ??= []).push(it);
    return acc;
  }, {});
  const listed = items.reduce((n, it) => n + (it.listed ?? 0), 0);
  const total = items.reduce((n, it) => n + (it.owned ?? 1), 0);

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="stock-head">
        <h1>Склад</h1>
        <span>
          {total} {total === 1 ? "предмет" : total < 5 ? "предмети" : "предметів"}
          {crates > 0 && ` · ${crates} ${crates === 1 ? "скринька" : crates < 5 ? "скриньки" : "скриньок"}`}
        </span>
      </div>

      {crates > 0 && (
        <button className="crate-open" onClick={() => ctx.push("shopItem", { item: { kind: "crate", code: "crate" } })}>
          <span className="crate-art">
            <img src="/assets/ui/crate.png" alt="щаслива скринька" />
            <img src="/assets/ui/crate_lid.png" alt="" />
            <i>{crates}</i>
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>Щасливі скриньки</b>
            <em>Відкрий, щоб побачити вміст</em>
          </span>
          <span className="pill pill-primary" style={{ padding: "9px 14px", fontSize: 13 }}>Відкрити</span>
        </button>
      )}

      {items.length === 0 && (
        <div className="panel muted">
          Склад порожній. Одяг падає зі скриньок, трапляється з покупкою кави або купується в Магазині.
        </div>
      )}

      {Object.entries(byCollection).map(([collection, list]) => (
        <div className="section" key={collection}>
          <div className="collection-head">
            <div className="sectionTitle">{collection}</div>
            <b>{list.length} з {sizes[collection] ?? list.length}</b>
          </div>
          {/* По п'ять у ряд, як слотів у примірочній; зайві переносяться. */}
          <div className="cells" style={{ flexWrap: "wrap" }}>
            {list.map((it) => (
              <button key={it.code} className="cell" onClick={() => ctx.push("itemCard", { item: it, owned: true })}>
                <ItemIcon sprite={it.sprite_id} size={36} name={it.name} style={{ width: "auto", maxWidth: "100%" }} />
                {it.owned > 1 && <i>×{it.owned}</i>}
              </button>
            ))}
          </div>
        </div>
      ))}

      {listed > 0 && (
        <button className="btn" onClick={() => ctx.push("listings")}>На продажу: {listed}</button>
      )}
    </div>
  );
}
