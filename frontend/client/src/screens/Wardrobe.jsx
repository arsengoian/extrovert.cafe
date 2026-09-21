// Гардероб: примірочна на п'ять слотів і подарунок зібраного комплекту.
//
// Зерна дає саме «Подарувати», а не заповнені слоти (economy §3.4) — тому
// на екрані весь час видно, скільки дасть поточний комплект і який предмет
// тягне його тір донизу.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { beans, items as itemsWord } from "../ui/plural.js";

const SLOT_LABEL = { head: "Голова", body: "Торс", pants: "Штани", feet: "Взуття", acc_1: "Аксесуар" };
const SLOT_ICON = { head: "slot_head", body: "slot_body", pants: "slot_pants", feet: "slot_feet", acc_1: "slot_acc1" };
const TIER_LABEL = { common: "Звичайний", uncommon: "Незвичайний", rare: "Рідкісний", epic: "Епічний" };

export function Wardrobe({ ctx, plant }) {
  const [data, setData] = useState(null);
  const [slot, setSlot] = useState(null);           // який слот зараз обираємо
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const id = plant?.id ?? data?.plant?.id;
  const load = () => api.get(`/me/plants/${plant.id}/wardrobe`).then(setData);
  useEffect(() => { load().catch((e) => setNote(e.body?.error ?? e.message)); }, [plant?.id]);

  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  const worn = data.slots.filter((s) => s.item).map((s) => s.item);
  const gifted = data.set?.gifted;

  const put = async (targetSlot, userItemId) => {
    setBusy(true);
    setNote(null);
    try {
      await api.put(`/me/plants/${id}/wardrobe/${targetSlot}`, { user_item_id: userItemId });
      await load();
      setSlot(null);
    } catch (e) {
      setNote(e.body?.error === "item_locked" ? "Предмет замкнений у подарованому комплекті" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const takeOff = async () => {
    setBusy(true);
    try { await api.del(`/me/plants/${id}/wardrobe`); await load(); }
    catch (e) { setNote(e.body?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const gift = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post(`/me/plants/${id}/wardrobe/gift`);
      await ctx.refreshMe();
      await load();
      setNote(`Кавенятко в захваті: +${beans(r.beans)}`);
    } catch (e) {
      setNote(e.body?.error === "incomplete" ? "Спершу заповни всі п'ять слотів" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const wear = async (setId) => {
    setBusy(true);
    try { await api.post(`/me/plants/${id}/wardrobe/wear`, { set_id: setId }); await load(); }
    catch (e) { setNote(e.body?.error ?? e.message); }
    finally { setBusy(false); }
  };

  const forSlot = data.available.filter((i) => i.slot === slot);
  const chosen = data.slots.find((s) => s.slot === slot)?.item ?? null;

  return (
    <div className="stage-pad">
      <div className="panel" style={{ paddingTop: 6 }}>
        <PlantView plant={data.plant} appearance={plant?.appearance} worn={worn} width={200} />
        <div className="row-between" style={{ marginTop: 6 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>{data.filled ? "Одягнено" : "Поки без одягу"}</div>
            <div style={{ fontWeight: 800 }}>
              {data.set?.complete ? (gifted ? "Подарований комплект" : "Повний комплект") : "Комплект збирається"}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {data.plant.name} · {data.filled} з {data.total} слотів
              {data.set?.tier ? ` · ${TIER_LABEL[data.set.tier]}` : ""}
            </div>
          </div>
          {data.filled > 0 && (
            <button className="btn" style={{ width: "auto", height: 38, padding: "0 14px", fontSize: 13 }}
                    disabled={busy} onClick={takeOff}>
              {gifted ? "Зняти" : "Зняти все"}
            </button>
          )}
        </div>
      </div>

      <div className="row-between" style={{ margin: "18px 4px 8px" }}>
        <span className="sectionTitle" style={{ margin: 0 }}>Примірочна</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {gifted ? "комплект замкнено" : data.total - data.filled ? `${data.total - data.filled} вільні` : "зі складу"}
        </span>
      </div>

      <div className="slot-row">
        {data.slots.map((s) => (
          <button key={s.slot} className={`slot-cell${s.item ? " on" : ""}`} onClick={() => setSlot(s.slot)}
                  title={SLOT_LABEL[s.slot]}>
            <img src={`/assets/ui/${SLOT_ICON[s.slot]}.png`} alt={SLOT_LABEL[s.slot]} className="slot-bg" />
            {s.item && <ItemIcon sprite={s.item.sprite_id} name={s.item.name} size={38}
                                 style={{ position: "relative", zIndex: 1 }} />}
          </button>
        ))}
      </div>

      <div className="panel row" style={{ gap: 12, marginTop: 16 }}>
        <img src="/assets/ui/bean.png" alt="" style={{ width: 28 }} />
        <div className="muted" style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4 }}>
          {gifted
            ? `Комплект уже подаровано: +${beans(data.set.beans_awarded)}. Предмети з нього замкнені назавжди.`
            : data.gift.can
              ? <>Подарунок рахується за рідкістю предмета «{data.gift.weakest_item}» – {data.gift.beans} <img src="/assets/ui/bean.png" alt="зерен" style={{ width: 12, verticalAlign: -2 }} /></>
              : `Подарувати можна лише повний комплект – бракує ${itemsWord(data.gift.missing)}`}
        </div>
        {!gifted && (
          <button className="btn btn-primary" style={{ width: "auto", padding: "0 18px", height: 42 }}
                  disabled={!data.gift.can || busy} onClick={gift}>
            Подарувати
          </button>
        )}
      </div>

      {data.ready.length > 0 && !gifted && (
        <>
          <div className="sectionTitle">Готові комплекти</div>
          {data.ready.map((r) => (
            <div key={r.id} className="panel row-between" style={{ padding: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{TIER_LABEL[r.tier]} комплект</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  подаровано {new Date(r.gifted_at).toLocaleDateString("uk-UA")} · +{beans(r.beans_awarded)}
                </div>
              </div>
              <button className="btn" style={{ width: "auto", padding: "0 16px", height: 38 }}
                      disabled={busy} onClick={() => wear(r.id)}>Вдягнути</button>
            </div>
          ))}
        </>
      )}

      {note && <div className="panel muted" style={{ fontSize: 12.5, marginTop: 12 }}>{note}</div>}

      {slot && (
        <Sheet title={SLOT_LABEL[slot]} onClose={() => setSlot(null)}>
          {gifted ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Комплект подаровано – його предмети замкнені. Зніми комплект, щоб зібрати новий.
            </p>
          ) : (
            <>
              <div className="grid3">
                {forSlot.map((item) => (
                  <button key={item.user_item_id} className={`panel${chosen?.user_item_id === item.user_item_id ? " on" : ""}`}
                          style={{ padding: 8, textAlign: "center" }} disabled={busy}
                          onClick={() => put(slot, item.user_item_id)}>
                    <ItemIcon sprite={item.sprite_id} size={52} />
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>{item.name}</div>
                    <div className={`tag tag-${item.tier}`} style={{ marginTop: 3 }}>{TIER_LABEL[item.tier]}</div>
                  </button>
                ))}
              </div>
              {forSlot.length === 0 && (
                <p className="muted" style={{ fontSize: 13 }}>
                  На складі немає предметів для цього слота. Вони випадають зі скриньок і продаються в магазині.
                </p>
              )}
              {chosen && (
                <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => put(slot, null)}>
                  Зняти «{chosen.name}»
                </button>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
