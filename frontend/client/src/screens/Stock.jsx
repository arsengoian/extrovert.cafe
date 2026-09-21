// Склад — за макетом «Gamification Screens», кадр «Склад»: заголовок із
// лічильником, картка нерозпакованих скриньок, комплекти по п'ять слотів і
// лоти на продажу внизу.
// Клітинка показує саму річ, а не картку з назвою: у макеті назви немає,
// бо п'ять слотів комплекту впізнаються за силуетом.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { plural } from "../ui/plural.js";

// Порядок слотів у ряду — як у примірочній: голова, тіло, штани, взуття,
// аксесуар. Порожній слот — пунктирна клітинка.
const SLOTS = ["head", "body", "pants", "feet", "acc_1"];

export function Stock({ ctx }) {
  const [items, setItems] = useState(null);
  const [crates, setCrates] = useState(0);
  const [lots, setLots] = useState([]);

  useEffect(() => {
    api.get("/me/items").then((r) => { setItems(r.items); setCrates(r.crates ?? 0); }).catch(() => setItems([]));
    api.get("/me/listings").then((r) => setLots(r.listings ?? [])).catch(() => {});
  }, []);

  if (!items) return <div className="stage-pad"><div className="skeleton" /></div>;

  const byCollection = items.reduce((acc, it) => {
    (acc[it.collection ?? "Інше"] ??= []).push(it);
    return acc;
  }, {});
  const total = items.reduce((n, it) => n + (it.owned ?? 1), 0);
  const lot = lots[0];

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="stock-head">
        <h1>Склад</h1>
        <span>
          {total} {plural(total, "предмет", "предмети", "предметів")}
          {crates > 0 && ` · ${crates} ${plural(crates, "скринька", "скриньки", "скриньок")}`}
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

      {Object.entries(byCollection).map(([collection, list]) => {
        const bySlot = Object.fromEntries(list.map((it) => [it.slot, it]));
        const full = SLOTS.every((s) => bySlot[s]);
        return (
          <div className="section" key={collection}>
            <div className="collection-head">
              <div className="sectionTitle">Комплект «{collection}»</div>
              <b data-full={full}>{list.length} з {SLOTS.length}</b>
            </div>
            <div className="cells">
              {SLOTS.map((slot) => {
                const it = bySlot[slot];
                if (!it) return <div key={slot} className="cell empty" />;
                return (
                  <button key={slot} className="cell" onClick={() => ctx.push("itemCard", { item: it, owned: true })}>
                    <ItemIcon sprite={it.sprite_id} size={36} name={it.name} style={{ width: 36 }} />
                    {it.owned > 1 && <i>×{it.owned}</i>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {lot && (
        <div className="on-sale">
          <button className="section-head" onClick={() => ctx.push("listings")}>
            <div className="sectionTitle">На продаж</div>
            <span className="link-more">
              усі {lots.length}
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M9.5 6 15.5 12 9.5 18" />
              </svg>
            </span>
          </button>
          <button className="lot-card" onClick={() => ctx.push("listings")}>
            {lot.item
              ? <ItemIcon sprite={lot.item.sprite_id} size={34} name={lot.item.name} style={{ width: 34, flex: "none" }} />
              : <img src="/assets/ui/sprout.png" alt="" style={{ width: 22, height: 34 }} />}
            <span className="lot-main">
              <b>{lot.item?.name ?? lot.plant?.name}</b>
              <small>{lot.item ? "заморожена до продажу" : "заморожене до продажу"}</small>
            </span>
            <span className="lot-price">
              <img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
              {lot.price}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
