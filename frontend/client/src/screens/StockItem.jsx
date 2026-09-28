// Попапи Складу — кадри «Попап предмета зі складу» і «Попап вибору
// кавенятка»: шторки над Складом, а не окремі екрани. Предмет — тір,
// слот, скільки є й вільних, дві дії; «Кому вдягнути» — кавенята з
// мініатюрою і тим, що станеться з річчю в цьому слоті.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { ConfirmSheet, ResultPopup } from "../ui/Popup.jsx";
import { PlantView } from "../plant/PlantView.jsx";
import { SLOT_OF, TIER_LABEL } from "./ItemCard.jsx";
import { plural } from "../ui/plural.js";
import { preferSelected } from "../plant/selected.js";

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

// «Окуляри будуть перенесені», «Сорочка буде перенесена», «Капелюх буде
// перенесений» — за закінченням першого слова назви: множина на -и/-і,
// жіночий рід на -а/-я, середній на -е/-о. Раніше було «лягає» (власник,
// 28.09.2026: «не лягає, а буде перенесений»).
const moved = (name) => {
  const w = name.split(/[ -]/)[0].toLowerCase();
  if (/[иі]$/.test(w)) return "будуть перенесені";
  if (/[ая]$/.test(w)) return "буде перенесена";
  if (/[ео]$/.test(w)) return "буде перенесене";
  return "буде перенесений";
};

// Успіх — коротким окремим попапом, без вибору кавенятка й без кнопок:
// «Успішно вдягнено!», і сам зникає (власник, 28.09.2026). Раніше шторка
// лишалась на місці з «У примірочній …» і двома кнопками.
const WORN_POPUP_MS = 1600;
function showWorn(ctx, item) {
  const close = () => ctx.notify(null);
  ctx.notify(
    <ResultPopup art={<ItemIcon sprite={item.sprite_id} size={62} alt={item.name} style={{ width: 62 }} />}
                 title="Успішно вдягнено!" action={null} onClose={close} />
  );
  setTimeout(close, WORN_POPUP_MS);
}

const slotName = (slot) => {
  const s = SLOT_OF[slot] ?? "";
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Людською мовою — чому річ не лягла в примірочну.
export const WEAR_ERROR = {
  item_locked: "Річ замкнена в подарованому комплекті",
  item_on_market: "Річ виставлена на продаж — спершу зніми лот",
  item_in_set: "Річ уже в іншому комплекті",
  on_sale: "Кавенятко на ринку",
  no_such_plant: "Кавенятка більше немає",
};

export function StockItemSheet({ item, ctx, onClose, onChanged }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Раніше тут ковталась будь-яка помилка (.catch(() => {})), а потім
  // відкривався гардероб — з тим самим порожнім слотом. Тап по порожньому
  // слоту веде на Склад, звідти знову сюди: власник назвав це вічним циклом
  // екранів (23.09.2026). Тепер нікуди не ведемо: кажемо, що сталось, і
  // лишаємось на місці.
  // Річ уже в примірочній котрогось кавенятка: кажемо, в чиїй, а кнопка —
  // «Перевдягнути» (власник, 28.09.2026). Вдягаємо вільну копію, а якщо
  // вільних немає — переносимо ту, що в примірочній (сервер забирає її з
  // попередньої, wardrobe.js).
  const fitting = item.fitting ?? [];
  const wearId = item.user_item_id ?? fitting[0]?.user_item_id ?? null;
  const wardrobe = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get("/me/plants").catch(() => ({ plants: [] }));
      const plants = (r.plants ?? []).filter((p) => !p.on_sale);
      if (!plants.length) { setError("Немає кавенятка, якому вдягнути"); return; }
      if (plants.length > 1) { ctx.notify(<WearSheet item={item} wearId={wearId} plants={plants} ctx={ctx} onClose={onClose} onChanged={onChanged} />); return; }
      await api.put(`/me/plants/${plants[0].id}/wardrobe/${item.slot}`, { user_item_id: wearId });
      onChanged?.();
      showWorn(ctx, item);
    } catch (e) {
      setError(WEAR_ERROR[e.body?.error] ?? errText(e));
    } finally {
      setBusy(false);
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
          <span>{slotName(item.slot)}{item.collection ? `, комплект «${item.collection}»` : ""}</span>
          <div className="stock-item-count">
            <i>×{item.owned ?? 1} на складі</i>
            <small>{item.free ?? 0} {plural(item.free ?? 0, "вільна", "вільні", "вільних")}</small>
          </div>
        </div>
      </div>
      {fitting.length > 0 && (
        <div className="stock-fitting">
          {item.name} – у примірочній {fitting.length > 1 ? "кавенят" : "кавенятка"} {fitting.map((x) => x.plant_name || "без імені").join(", ")}
        </div>
      )}
      {error && <div className="short-note" style={{ color: "var(--accent-text)" }}>{error}</div>}
      <div className="stock-item-actions">
        <button className="cta wide" disabled={!wearId || busy} onClick={wardrobe}>
          {busy ? "…" : fitting.length ? "Перевдягнути" : "Додати до гардеробу"}
        </button>
        <button className="cta wide ghost" disabled={!item.free} onClick={() => { onClose(); ctx.push("sellItem", { item }); }}>
          Продати іншому користувачу
        </button>
      </div>
    </ConfirmSheet>
  );
}

export function WearSheet({ item, wearId, plants, ctx, onClose, onChanged }) {
  // За замовчуванням — обране кавенятко (plant/selected.js), не перше.
  const [chosen, setChosen] = useState(() => preferSelected(plants));
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
      await api.put(`/me/plants/${chosen.id}/wardrobe/${item.slot}`, { user_item_id: wearId ?? item.user_item_id });
      onChanged?.();
      showWorn(ctx, item);
    } catch (e) {
      const code = e.body?.error;
      setError(WEAR_ERROR[code] ?? code ?? e.message);
    }
  };

  return (
    <ConfirmSheet onCancel={onClose} padding="18px 16px">
      <Head title="Кому вдягнути" onClose={onClose} />
      <div className="wear-info">
        <span className={`wear-tile tier-${item.tier}`}>
          <ItemIcon sprite={item.sprite_id} size={34} name={item.name} style={{ width: 34 }} />
        </span>
        <span>{item.name} {moved(item.name)} у примірочну обраного кавенятка</span>
      </div>
      <div className="pick-list static">
        {plants.map((p) => {
          const busySlot = slots[p.id];
          // Ця сама річ уже в його примірочній — не «повернеться на склад»,
          // а «уже одягнено» (власник, 28.09.2026).
          const same = busySlot?.code === item.code;
          return (
            <button key={p.id} className="pick-row wear-row" data-on={chosen?.id === p.id || undefined} onClick={() => setChosen(p)}>
              <i />
              <span className="wear-thumb"><PlantView plant={p} width={58} height={70} fit="stage" /></span>
              <span>
                <b>{p.name || "Без імені"}</b>
                <small>{same ? `${item.name} уже одягнено` : busySlot ? `«${busySlot.name}» буде повернуто на склад` : "вільний слот у примірочній"}</small>
              </span>
            </button>
          );
        })}
      </div>
      {error && <div className="short-note" style={{ color: "var(--accent-text)" }}>{error}</div>}
      {slots[chosen?.id]?.code === item.code
        ? <button className="cta wide" disabled>Уже одягнено</button>
        : <button className="cta wide" disabled={!chosen} onClick={wear}>Вдягнути {chosen?.name ?? ""}</button>}
    </ConfirmSheet>
  );
}
