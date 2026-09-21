// Попапи Складу — кадри «Попап предмета зі складу» і «Попап вибору
// кавенятка»: шторки над Складом, а не окремі екрани. Предмет — тір,
// слот, скільки є й вільних, дві дії; «Кому вдягнути» — кавенята з
// мініатюрою і тим, що станеться з річчю в цьому слоті.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { ConfirmSheet } from "../ui/Popup.jsx";
import { PlantView } from "../plant/PlantView.jsx";
import { SLOT_OF, TIER_LABEL } from "./ItemCard.jsx";
import { plural } from "../ui/plural.js";

const Head = ({ title, onClose }) => (
  <div className="pick-head">
    <b>{title}</b>
    <button aria-label="Закрити" onClick={onClose}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
      </svg>
    </button>
  </div>
);

// «Окуляри лягають», «Сорочка лягає»: назви в множині закінчуються на -и/-і.
const lies = (name) => (/[иі]$/i.test(name.split(/[ -]/)[0]) ? "лягають" : "лягає");

const slotName = (slot) => {
  const s = SLOT_OF[slot] ?? "";
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function StockItemSheet({ item, ctx, onClose }) {
  const wardrobe = async () => {
    const r = await api.get("/me/plants").catch(() => ({ plants: [] }));
    const plants = (r.plants ?? []).filter((p) => !p.on_sale);
    if (plants.length === 1) {
      await api.put(`/me/plants/${plants[0].id}/wardrobe/${item.slot}`, { user_item_id: item.user_item_id }).catch(() => {});
      onClose();
      ctx.push("wardrobe", { plant: plants[0] });
    } else {
      ctx.notify(<WearSheet item={item} plants={plants} ctx={ctx} onClose={onClose} />);
    }
  };

  return (
    <ConfirmSheet onCancel={onClose} padding="18px 16px">
      <Head title={item.name} onClose={onClose} />
      <div className="stock-item">
        <span className={`stock-item-tile tier-${item.tier}`}>
          <ItemIcon sprite={item.sprite_id} size={74} name={item.name} style={{ width: 74 }} />
        </span>
        <div>
          <b className={`tier-text tier-${item.tier}`}>{TIER_LABEL[item.tier]}</b>
          <span>{slotName(item.slot)}{item.collection ? ` · комплект «${item.collection}»` : ""}</span>
          <div className="stock-item-count">
            <i>×{item.owned ?? 1} на складі</i>
            <small>{item.free ?? 0} {plural(item.free ?? 0, "вільна", "вільні", "вільних")}</small>
          </div>
        </div>
      </div>
      <div className="stock-item-actions">
        <button className="cta wide" disabled={!item.free} onClick={wardrobe}>Додати до гардеробу</button>
        <button className="cta wide ghost" disabled={!item.free} onClick={() => { onClose(); ctx.push("sellItem", { item }); }}>
          Продати іншому гравцю
        </button>
      </div>
    </ConfirmSheet>
  );
}

export function WearSheet({ item, plants, ctx, onClose }) {
  const [chosen, setChosen] = useState(plants[0] ?? null);
  const [slots, setSlots] = useState({});
  const [error, setError] = useState(null);

  // Що зараз лежить у цьому слоті кожного кавенятка — воно повернеться на склад.
  useEffect(() => {
    Promise.all(plants.map((p) => api.get(`/me/plants/${p.id}/wardrobe`)
      .then((w) => [p.id, w.slots?.find((s) => s.slot === item.slot)?.item ?? null])
      .catch(() => [p.id, null])))
      .then((pairs) => setSlots(Object.fromEntries(pairs)));
  }, [item.slot]);

  const wear = async () => {
    setError(null);
    try {
      await api.put(`/me/plants/${chosen.id}/wardrobe/${item.slot}`, { user_item_id: item.user_item_id });
      onClose();
      ctx.push("wardrobe", { plant: chosen });
    } catch (e) {
      const code = e.body?.error;
      setError(code === "item_locked" ? "Річ замкнена в подарованому комплекті" : code === "on_sale" ? "Кавенятко на маркеті" : code ?? e.message);
    }
  };

  return (
    <ConfirmSheet onCancel={onClose} padding="18px 16px">
      <Head title="Кому вдягнути" onClose={onClose} />
      <div className="wear-info">
        <span className={`wear-tile tier-${item.tier}`}>
          <ItemIcon sprite={item.sprite_id} size={34} name={item.name} style={{ width: 34 }} />
        </span>
        <span>{item.name} {lies(item.name)} у примірочну обраного кавенятка</span>
      </div>
      <div className="pick-list static">
        {plants.map((p) => {
          const busySlot = slots[p.id];
          return (
            <button key={p.id} className="pick-row wear-row" data-on={chosen?.id === p.id || undefined} onClick={() => setChosen(p)}>
              <i />
              <span className="wear-thumb"><PlantView plant={p} width={58} height={70} fit="stage" /></span>
              <span>
                <b>{p.name || "Без імені"}</b>
                <small>{busySlot ? `«${busySlot.name}» буде повернуто на склад` : "вільний слот у примірочній"}</small>
              </span>
            </button>
          );
        })}
      </div>
      {error && <div className="short-note" style={{ color: "var(--accent-text)" }}>{error}</div>}
      <button className="cta wide" disabled={!chosen} onClick={wear}>Вдягнути {chosen?.name ?? ""}</button>
    </ConfirmSheet>
  );
}
