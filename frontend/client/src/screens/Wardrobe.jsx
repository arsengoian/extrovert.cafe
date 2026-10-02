// «Гардероб»: мініатюра кавенятка й що на ньому, смуга подарованих
// комплектів, п'ять слотів примірочної і подарунок зібраного в ній
// комплекту.
//
// Модель (власник, 27.09.2026): у кавенятка скільки завгодно подарованих
// комплектів, і вдягнене — або один із них, або речі з примірочної.
// Примірочна існує, щоб зібрати НОВИЙ комплект: вдягнути подарований її не
// розбирає, а «Подарувати» дарує саме її. Речі кладуть у слоти зі складу
// («Вдягнути» в попапі предмета), тож порожній слот веде на склад, а
// заповнений — пропонує зняти річ. Зерна дає саме «Подарувати», а не
// заповнені слоти (economy §3.4) — тому внизу весь час видно, скільки дасть
// примірочна і який предмет тягне тір донизу.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { ConfirmSheet } from "../ui/Popup.jsx";
import { plural } from "../ui/plural.js";
import { leaveHandoff } from "../plant/handoff.js";

// Місце слота в примірочній 328×199, картинки слота й листкової рамки.
const SLOTS = {
  head: { at: [0, 0], bg: "slot_head", leaf: "leaf_head", size: [62, 36], label: "Голова" },
  body: { at: [114, 0], bg: "slot_body", leaf: "leaf_body", size: [54, 57], label: "Торс" },
  pants: { at: [228, 0], bg: "slot_pants", leaf: "leaf_pants", size: [50, 58], label: "Штани" },
  feet: { at: [57, 99], bg: "slot_feet", leaf: "leaf_feet", size: [35, 59], label: "Взуття" },
  acc_1: { at: [171, 99], bg: "slot_acc1", leaf: "leaf_acc1", size: [55, 55], label: "Аксесуар" },
};

// Мініатюри речей на плитці комплекту — розміри з макета: голова, торс і
// штани стовпчиком, поруч аксесуар над взуттям (власник, 28.09.2026: у
// макеті взуття стояло зверху).
const MINI = {
  head: [26, 16], body: [21, 22], pants: [18, 21], feet: [13, 23], acc_1: [21, 21],
};
const COLUMNS = [["head", "body", "pants"], ["acc_1", "feet"]];

// Плитка «Приміряти» — усі п'ять слотів примірочної тими самими
// стовпчиками 3 + 2, що й у комплекту: річ, якщо вона вже лежить у слоті,
// інакше порожній слот. Раніше тут був один силует торса (власник,
// 28.09.2026). Вибрана — «приміряно», а не «одягнено»: подаровані
// комплекти вдягають, а примірочну приміряють.
const FIT_MINI = [20, 24];   // сторона значка: ліва колонка, права

function FittingTile({ slots, worn, busy, onTry }) {
  return (
    <button className="wr-set" data-worn={worn || undefined} disabled={busy} onClick={worn ? undefined : onTry}>
      <span className="wr-set-box fitting">
        {COLUMNS.map((col, n) => (
          <span key={n} className="wr-set-col" style={{ gap: 2 }}>
            {col.map((slot) => {
              const it = slots.find((s) => s.slot === slot)?.item;
              const side = FIT_MINI[n];
              return it
                ? <ItemIcon key={slot} sprite={it.sprite_id} alt={it.name} size={side} style={{ width: side }} />
                : <img key={slot} src={`/assets/ui/${SLOTS[slot].bg}.webp`} alt="" style={{ width: side, height: side }} />;
            })}
          </span>
        ))}
      </span>
      <span className="wr-set-label">{worn ? "приміряно" : "приміряти"}</span>
    </button>
  );
}

const Bean = ({ w = 15, h = 17 }) => <img src="/assets/ui/bean.webp" alt="кавових зерен" style={{ width: w, height: h, display: "inline", verticalAlign: -4 }} />;

function SetTile({ set, onWear }) {
  return (
    <button className="wr-set" data-worn={set.worn || undefined} onClick={set.worn ? undefined : onWear}>
      <span className={`wr-set-box tier-${set.tier}`}>
        {COLUMNS.map((col, n) => (
          <span key={n} className="wr-set-col" style={{ gap: n ? 3 : 1 }}>
            {col.map((slot) => {
              const it = set.items.find((i) => i.slot === slot);
              const [w, h] = MINI[slot];
              return it ? <ItemIcon key={slot} sprite={it.sprite_id} alt={it.name} size={h} style={{ width: w }} /> : null;
            })}
          </span>
        ))}
      </span>
      <span className="wr-set-label">{set.worn ? "одягнено" : "одягнути"}</span>
    </button>
  );
}

export function Wardrobe({ ctx, plant }) {
  const [data, setData] = useState(null);
  const [asked, setAsked] = useState(null);         // слот, з якого пропонуємо зняти річ
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const id = plant?.id;
  const load = () => api.get(`/me/plants/${id}/wardrobe`).then(setData);
  useEffect(() => { load().catch((e) => setNote(errText(e))); }, [id]);

  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  const worn = data.worn ?? { kind: null, slots: [], filled: 0, complete: false };
  const wornItems = worn.slots.filter((s) => s.item).map((s) => s.item);
  const complete = data.set?.complete;              // примірочна зібрана
  const free = data.total - data.filled;
  // Новіші подаровані — зліва, старші відходять праворуч у скрол
  // (власник, 28.09.2026); api віддає їх від найстарішого.
  const sets = [...(data.sets ?? [])].sort((a, b) => new Date(b.gifted_at) - new Date(a.gifted_at));
  const fittingWorn = worn.kind === "fitting";

  const run = async (fn) => {
    setBusy(true);
    setNote(null);
    try { await fn(); } catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  };

  const takeOff = () => run(async () => { await api.del(`/me/plants/${id}/wardrobe`); await load(); });
  const takeOne = (slot) => run(async () => {
    await api.put(`/me/plants/${id}/wardrobe/${slot}`, { user_item_id: null });
    setAsked(null);
    await load();
  });
  const wear = (setId) => run(async () => { await api.post(`/me/plants/${id}/wardrobe/wear`, { set_id: setId }); await load(); });
  // «Приміряти» — вдягнути речі з примірочної; порожня примірочна веде на
  // склад, звідки речі в неї й потрапляють.
  const tryOn = () => (data.filled && data.set ? wear(data.set.id) : ctx.openTab("stock"));
  const gift = () => run(async () => {
    try {
      const r = await api.post(`/me/plants/${id}/wardrobe/gift`);
      // Замість рядка «Кавенятко в захваті» — головний екран із цим
      // кавенятком, і боби летять із його бочки в баланс (власник,
      // 27.09.2026). Баланс оновлює вже головний екран: тут шапки немає,
      // і приріст, який вона мала б показати, просто пропав би.
      leaveHandoff({ kind: "gift", plantId: id, beans: r.beans });
      ctx.openTab("plant");
    } catch (e) {
      if (e.body?.error === "incomplete") throw Object.assign(e, { body: { error: "Спершу заповни всі п'ять слотів" } });
      if (e.body?.error === "not_grown") throw Object.assign(e, { body: { error: "Кавенятко ще росте – подарувати одяг можна лише дорослому" } });
      throw e;
    }
  });

  const tapSlot = (s) => {
    if (!s.item) { ctx.openTab("stock"); return; }
    setAsked(s.slot);
  };
  const askedItem = asked ? data.slots.find((s) => s.slot === asked)?.item : null;

  // Заголовок — ім'я кавенятка, а стан — рядком нижче (власник, 27.09.2026).
  const status = !worn.kind ? "Нічого не вдягнено"
    : worn.complete ? `Повний комплект (${worn.filled} з ${data.total} слотів)`
    : `Комплект збирається (${worn.filled} з ${data.total} слотів)`;

  return (
    <div className="stage-pad wardrobe">
      <div className="wr-head">
        <div className="wr-preview">
          <PlantView plant={data.plant} appearance={plant?.appearance} worn={wornItems} width={118} height={150} fit="stage" />
        </div>
        <div className="wr-info">
          <div className="sectionTitle">Одягнено</div>
          <b>{data.plant.name || "Кавенятко"}</b>
          <small>{status}</small>
          <button disabled={busy || !worn.kind} onClick={takeOff}>{worn.kind === "gifted" || worn.complete ? "Зняти комплект" : "Зняти все"}</button>
        </div>
      </div>

      {sets.length > 0 && (
        <div className="wr-section">
          <div className="wr-section-head">
            <div className="sectionTitle">Комплекти</div>
            <span>{sets.length} {plural(sets.length, "подарований", "подаровані", "подарованих")}</span>
          </div>
          <div className="wr-strip">
            <div className="wr-strip-row">
              <FittingTile slots={data.slots} worn={fittingWorn} busy={busy} onTry={tryOn} />
              {sets.map((set) => <SetTile key={set.id} set={set} onWear={() => wear(set.id)} />)}
            </div>
            <i className="wr-strip-fade" />
          </div>
        </div>
      )}

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
                <img src={`/assets/ui/${g.bg}.webp`} alt="" />
                {s.item && (
                  <>
                    <i className={`tier-${s.item.tier}`} />
                    <ItemIcon sprite={s.item.sprite_id} name={s.item.name} alt={s.item.name} size={g.size[1]}
                              style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: g.size[0] }} />
                    <img src={`/assets/ui/${g.leaf}.webp`} alt="" />
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wr-gift">
        <img src="/assets/ui/bean.webp" alt="" />
        <div>
          {data.gift.can
            ? <>Подарунок розраховується на основі рідкості предмета «{data.gift.weakest_item}» – {data.gift.beans} <Bean /></>
            : data.gift.missing > 0
              ? `Подарувати можна лише повний комплект – бракує ${data.gift.missing === 1 ? "1 предмета" : `${data.gift.missing} предметів`}`
              /* Комплект зібрано, але кущ ще росте. Кажемо це тут, а не
                 помилкою після натискання: предмети замикаються назавжди,
                 і людина має розуміти умову до того, як тисне. */
              : "Подарувати одяг можна лише дорослому кавенятку – спершу вирости його до останнього етапу"}
        </div>
        <button disabled={!data.gift.can || busy} onClick={gift}>Подарувати</button>
      </div>

      {note && <div className="wr-note">{note}</div>}

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
