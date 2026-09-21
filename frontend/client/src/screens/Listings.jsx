// «На продаж» — кадр «На продаж · список лотів»: лоти гравця з плиткою
// кольору тіру, переглядами й віком, «Зняти» через шторку «Зняти з
// продажу?», пояснення, чому лот стоїть, і що предмет заморожений.
//
// Лічильник переглядів тут головне: маркет пропонує покупцям вибірку, і
// зрозуміти, чому лот не продається, можна лише за ним (services.md §4).
// Відстає він не більше ніж на хвилину.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { ConfirmSheet } from "../ui/Popup.jsx";
import { plural } from "../ui/plural.js";
import { SLOT_OF, TIER_LABEL } from "./ItemCard.jsx";

const Eye = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" />
  </svg>
);

// «сьогодні», «2 дні тому», «тиждень тому» — як у макеті.
const age = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (d <= 0) return "сьогодні";
  if (d === 1) return "вчора";
  if (d < 7) return `${d} ${plural(d, "день", "дні", "днів")} тому`;
  if (d < 14) return "тиждень тому";
  const w = Math.floor(d / 7);
  return `${w} ${plural(w, "тиждень", "тижні", "тижнів")} тому`;
};

function LotTile({ lot }) {
  return lot.kind === "item" ? (
    <span className={`lot-tile tier-${lot.item?.tier}`}>
      <ItemIcon sprite={lot.item?.sprite_id} size={38} style={{ width: 38 }} />
    </span>
  ) : (
    <span className="lot-tile plant"><img src="/assets/ui/sprout.png" alt="" /></span>
  );
}

const lotName = (lot) => (lot.kind === "item" ? lot.item?.name : lot.plant?.name || "Кавенятко");
const lotKind = (lot) => (lot.kind === "item"
  ? `${TIER_LABEL[lot.item?.tier] ?? ""} · ${SLOT_OF[lot.item?.slot] ?? ""}`
  : `кавенятко · стадія ${lot.plant?.growth_stage ?? 0}`);

const Price = ({ lot }) => (
  <b className="lot-price-b">
    <img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />{lot.price}
  </b>
);

export function Listings() {
  const [listings, setListings] = useState(null);
  const [asked, setAsked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.get("/me/listings").then((r) => setListings(r.listings));
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  if (error && !listings) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!listings) return <div className="stage-pad"><div className="skeleton" /></div>;

  const cancel = async (lot) => {
    setBusy(true);
    try { await api.del(`/market/listings/${lot.id}`); setAsked(null); await load(); }
    catch (e) { setError(e.body?.error ?? e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="stock-head">
        <h1>Мої лоти</h1>
        <span>{listings.length} {plural(listings.length, "активний", "активні", "активних")}</span>
      </div>

      {listings.length === 0 ? (
        <div className="panel muted">Зараз нічого не продається. Виставити річ можна з її картки на Складі, а кавенятко – з його екрана.</div>
      ) : (
        <div className="orders">
          {listings.map((lot) => (
            <div key={lot.id} className="lot">
              <LotTile lot={lot} />
              <div className="lot-body">
                <b>{lotName(lot)}</b>
                <strong className={lot.kind === "item" ? `tier-text tier-${lot.item?.tier}` : undefined}>{lotKind(lot)}</strong>
                <small>
                  <span><Eye />{lot.impressions} {plural(lot.impressions, "перегляд", "перегляди", "переглядів")}</span>
                  <span>{age(lot.created_at)}</span>
                </small>
              </div>
              <div className="lot-end">
                <Price lot={lot} />
                <button className="pill pill-primary" onClick={() => setAsked(lot)}>Зняти</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="why">
        <b>Чому один лот стоїть довше</b>
        <p>Твій лот показують поруч із тим самим товаром від кафе, і чим дешевший він за сусідів, тим частіше його бачать покупці. Якщо хочеш, щоб купили швидко, став ціну в нижній частині діапазону і дешевше, ніж продає кафе.</p>
      </div>

      <div className="hint-chip">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" />
        </svg>
        Поки лот активний, предмет заморожений: вдягнути або подарувати його неможливо.
      </div>

      {asked && (
        <ConfirmSheet onCancel={() => setAsked(null)} padding="18px 16px">
          <div className="pick-head">
            <b>Зняти з продажу?</b>
            <button aria-label="Закрити" onClick={() => setAsked(null)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
              </svg>
            </button>
          </div>
          <div className="lot flat">
            <LotTile lot={asked} />
            <div className="lot-body">
              <b>{lotName(asked)}</b>
              <strong className={asked.kind === "item" ? `tier-text tier-${asked.item?.tier}` : undefined}>{lotKind(asked)}</strong>
            </div>
            <Price lot={asked} />
          </div>
          <div className="short-note">
            {asked.kind === "item"
              ? "Предмет повернеться на склад і одразу розморозиться – його знову можна вдягнути або подарувати кавенятку."
              : "Кавенятко повернеться додому й знову чекатиме на догляд."}
          </div>
          <div className="confirm-btns r13">
            <button onClick={() => setAsked(null)}>Лишити</button>
            <button disabled={busy} onClick={() => cancel(asked)}>{asked.kind === "item" ? "Повернути на склад" : "Повернути додому"}</button>
          </div>
        </ConfirmSheet>
      )}
    </div>
  );
}
