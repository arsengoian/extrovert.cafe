// «Гардероб»: мініатюра кавенятка, що на ньому, п'ять слотів примірочної
// і подарунок зібраного комплекту.
//
// Речі кладуть у слоти зі складу («Вдягнути» в попапі предмета), тож тут
// порожній слот веде на склад, а заповнений — пропонує зняти річ. Зерна дає
// саме «Подарувати», а не заповнені слоти (economy §3.4) — тому внизу весь
// час видно, скільки дасть поточний комплект і який предмет тягне тір донизу.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { ConfirmSheet } from "../ui/Popup.jsx";
import { beans, plural } from "../ui/plural.js";

// Місце слота в примірочній 328×199, картинки слота й листкової рамки.
const SLOTS = {
  head: { at: [0, 0], bg: "slot_head", leaf: "leaf_head", size: [62, 36], label: "Голова" },
  body: { at: [114, 0], bg: "slot_body", leaf: "leaf_body", size: [54, 57], label: "Торс" },
  pants: { at: [228, 0], bg: "slot_pants", leaf: "leaf_pants", size: [50, 58], label: "Штани" },
  feet: { at: [57, 99], bg: "slot_feet", leaf: "leaf_feet", size: [35, 59], label: "Взуття" },
  acc_1: { at: [171, 99], bg: "slot_acc1", leaf: "leaf_acc1", size: [55, 55], label: "Аксесуар" },
};

const Bean = ({ w = 15, h = 17 }) => <img src="/assets/ui/bean.png" alt="кавових зерен" style={{ width: w, height: h, display: "inline", verticalAlign: -4 }} />;

export function Wardrobe({ ctx, plant }) {
  const [data, setData] = useState(null);
  const [asked, setAsked] = useState(null);         // слот, з якого пропонуємо зняти річ
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const id = plant?.id;
  const load = () => api.get(`/me/plants/${id}/wardrobe`).then(setData);
  useEffect(() => { load().catch((e) => setNote(e.body?.error ?? e.message)); }, [id]);

  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  const worn = data.slots.filter((s) => s.item).map((s) => s.item);
  const gifted = data.set?.gifted;
  const complete = data.set?.complete;
  const free = data.total - data.filled;

  const run = async (fn) => {
    setBusy(true);
    setNote(null);
    try { await fn(); } catch (e) { setNote(e.body?.error ?? e.message); } finally { setBusy(false); }
  };

  const takeOff = () => run(async () => { await api.del(`/me/plants/${id}/wardrobe`); await load(); });
  const takeOne = (slot) => run(async () => {
    try { await api.put(`/me/plants/${id}/wardrobe/${slot}`, { user_item_id: null }); }
    catch (e) { if (e.body?.error === "item_locked") throw Object.assign(e, { body: { error: "Предмет замкнений у подарованому комплекті" } }); throw e; }
    setAsked(null);
    await load();
  });
  const gift = () => run(async () => {
    try {
      const r = await api.post(`/me/plants/${id}/wardrobe/gift`);
      await ctx.refreshMe();
      await load();
      setNote(`Кавенятко в захваті: +${beans(r.beans)}`);
    } catch (e) {
      if (e.body?.error === "incomplete") throw Object.assign(e, { body: { error: "Спершу заповни всі п'ять слотів" } });
      throw e;
    }
  });
  const wear = (setId) => run(async () => { await api.post(`/me/plants/${id}/wardrobe/wear`, { set_id: setId }); await load(); });

  const tapSlot = (s) => {
    if (!s.item) { ctx.openTab("stock"); return; }
    if (gifted) { setNote("Комплект подаровано – його предмети замкнені. Зніми комплект, щоб зібрати новий."); return; }
    setAsked(s.slot);
  };
  const askedItem = asked ? data.slots.find((s) => s.slot === asked)?.item : null;

  return (
    <div className="stage-pad wardrobe">
      <div className="wr-head">
        <div className="wr-preview">
          <PlantView plant={data.plant} appearance={plant?.appearance} worn={worn} width={118} height={150} fit="stage" />
        </div>
        <div className="wr-info">
          <div className="sectionTitle">Одягнено</div>
          <b>{complete ? (gifted ? "Подарований комплект" : "Повний комплект") : "Комплект збирається"}</b>
          <small>{data.plant.name} · {data.filled} з {data.total} слотів</small>
          <button disabled={busy || !data.filled} onClick={takeOff}>{complete ? "Зняти комплект" : "Зняти все"}</button>
        </div>
      </div>

      <div className="wr-section">
        <div className="wr-section-head">
          <div className="sectionTitle">{complete ? "Примірочна" : "Слоти"}</div>
          <span>{complete ? "зі складу" : `${free} ${plural(free, "вільний", "вільні", "вільних")}`}</span>
        </div>
        <div className="wr-slots">
          {data.slots.map((s) => {
            const g = SLOTS[s.slot];
            return (
              <button key={s.slot} className="wr-slot" title={g.label} style={{ left: g.at[0], top: g.at[1] }} onClick={() => tapSlot(s)}>
                <img src={`/assets/ui/${g.bg}.png`} alt="" />
                {s.item && (
                  <>
                    <i className={`tier-${s.item.tier}`} />
                    <ItemIcon sprite={s.item.sprite_id} name={s.item.name} alt={s.item.name} size={g.size[1]}
                              style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: g.size[0] }} />
                    <img src={`/assets/ui/${g.leaf}.png`} alt="" />
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wr-gift">
        <img src="/assets/ui/bean.png" alt="" />
        <div>
          {gifted
            ? <>Комплект уже подаровано: +{data.set.beans_awarded} <Bean />. Предмети з нього замкнені назавжди.</>
            : data.gift.can
              ? <>Подарунок розраховується на основі рідкості предмета «{data.gift.weakest_item}» – {data.gift.beans} <Bean /></>
              : `Подарувати можна лише повний комплект – бракує ${data.gift.missing === 1 ? "1 предмета" : `${data.gift.missing} предметів`}`}
        </div>
        {!gifted && <button disabled={!data.gift.can || busy} onClick={gift}>Подарувати</button>}
      </div>

      {note && <div className="wr-note">{note}</div>}

      {data.ready.length > 0 && !gifted && (
        <div className="wr-section">
          <div className="sectionTitle">Подаровані комплекти</div>
          {data.ready.map((r) => (
            <div key={r.id} className="wr-ready">
              <div>
                <b>Комплект від {new Date(r.gifted_at).toLocaleDateString("uk-UA")}</b>
                <small>+{r.beans_awarded} <Bean w={12} h={14} /></small>
              </div>
              <button className="pill" disabled={busy} onClick={() => wear(r.id)}>Вдягнути</button>
            </div>
          ))}
        </div>
      )}

      {askedItem && (
        <ConfirmSheet onCancel={() => setAsked(null)}>
          <div className="short-title">Зняти «{askedItem.name}»?</div>
          <div className="short-note">Річ повернеться на склад, слот «{SLOTS[asked].label}» звільниться.</div>
          <div className="confirm-btns r14">
            <button onClick={() => setAsked(null)}>Скасувати</button>
            <button disabled={busy} onClick={() => takeOne(asked)}>Зняти</button>
          </div>
        </ConfirmSheet>
      )}
    </div>
  );
}
