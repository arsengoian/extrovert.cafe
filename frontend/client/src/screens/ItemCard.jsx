// Превʼю одягу — кадр «Превʼю одягу»: предмет у сяйві, назва з чипом
// тіру, опис і що дасть комплект, лоти інших гравців і ціна магазину.
// Лоти лежать прямо в превʼю, як у макеті: на маркеті та сама річ часто
// дешевша, і ховати це від гравця нечесно.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { renderMarkdown } from "../ui/markdown.jsx";
import { NotEnoughBeans, NotEnoughCoins } from "../ui/NotEnough.jsx";

export const TIER_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };
export const SLOT_OF = { head: "слот голови", body: "слот тіла", pants: "слот штанів", feet: "слот взуття", acc_1: "слот аксесуара" };
const SET_BEANS = { common: 3, uncommon: 6, rare: 9, epic: 15 };

export function ItemCard({ item, ctx }) {
  const [offers, setOffers] = useState(null);
  const [stock, setStock] = useState(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const code = item?.code;
  const load = () => Promise.all([
    api.get(`/market/offers?item=${encodeURIComponent(code)}&limit=${all ? 50 : 3}`).then(setOffers).catch(() => setOffers({ offers: [], total: 0 })),
    api.get("/me/items").then((r) => setStock(r.items)).catch(() => setStock([])),
  ]);
  useEffect(() => { if (code) load(); }, [code, all]);

  if (!item) return null;

  // Скільки слотів комплекту вже закрито: рахуємо за колекцією предмета.
  const slotsOwned = new Set((stock ?? []).filter((i) => i.collection && i.collection === item.collection).map((i) => i.slot)).size;
  const price = item.price_coins;
  const tierOf = (t) => TIER_LABEL[t] ?? t;

  const short = (need) => {
    const b = ctx.me?.balances ?? {};
    ctx.notify(<NotEnoughCoins what={item.name} price={need} have={(b.silver ?? 0) + (b.yellow ?? 0)} ctx={ctx} onClose={() => ctx.notify(null)} />);
  };

  const buyFromShop = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/shop/buy", { code: "item", item: item.code });
      await ctx.refreshMe();
      setNote(`«${r.name}» на складі.`);
      await load();
    } catch (e) {
      if (e.body?.error === "not_enough") short(price);
      else setError(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const buyLot = async (lot) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/market/listings/${lot.id}/buy`);
      await ctx.refreshMe();
      setNote(`Куплено в ${lot.seller} за ${lot.price}.`);
      await load();
    } catch (e) {
      const c = e.body?.error;
      if (c === "not_enough" && lot.currency === "yellow") short(lot.price);
      else if (c === "not_enough") {
        ctx.notify(<NotEnoughBeans what={item.name} price={lot.price} have={ctx.me?.balances?.beans ?? 0}
                                   ctx={ctx} onClose={() => ctx.notify(null)} />);
      } else setError(c === "already_gone" ? "Лот уже купили" : c ?? e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quiz">
      <div className={`item-hero tier-${item.tier}`}>
        <ItemIcon sprite={item.sprite_id} size={120} alt={item.name} name={item.name} style={{ width: 120 }} />
      </div>

      <div className="preview-head">
        <h2>{item.name}</h2>
        <div className="item-meta">
          <span className={`tier-chip tier-${item.tier}`}>{tierOf(item.tier)}</span>
          <span>{SLOT_OF[item.slot] ?? item.slot}{item.collection ? ` · комплект «${item.collection}»` : ""}</span>
        </div>
      </div>

      <div className="item-text">
        {item.description_md ? renderMarkdown(item.description_md) : null}
        {item.collection && (
          <div>
            У тебе вже {slotsOwned} з 5 предметів комплекту. За повний комплект кавенятко дасть {SET_BEANS[item.tier] ?? 3}{" "}
            <img src="/assets/ui/bean.png" alt="кавових зерна" />: рідкість рахується за найслабшим предметом
            {item.tier === "common" ? ", а всі пʼять тут Common (Uncommon – 6, Rare – 9, Epic – 15)." : "."}
          </div>
        )}
      </div>

      {offers?.offers?.length > 0 && (
        <div className="offers">
          <div className="section-head" style={{ alignItems: "baseline" }}>
            <div className="sectionTitle">Від інших користувачів</div>
            {offers.total > offers.offers.length && (
              <button className="link-more" onClick={() => setAll(true)}>усі {offers.total} лотів</button>
            )}
          </div>
          {offers.offers.map((lot, i) => {
            const cheaper = price && lot.currency === "yellow" && lot.price < price;
            return (
              <div key={lot.id} className="offer">
                <span className={`offer-tile tier-${lot.item?.tier ?? item.tier}`}>
                  <ItemIcon sprite={lot.item?.sprite_id ?? item.sprite_id} size={36} style={{ width: 36 }} />
                </span>
                <div className="offer-main">
                  <b>{lot.item?.name ?? item.name}</b>
                  <small>продає {lot.seller}</small>
                  <em>{cheaper ? `дешевше за магазин на ${price - lot.price}` : `${tierOf(lot.item?.tier ?? item.tier)} · ${SLOT_OF[lot.item?.slot ?? item.slot]}`}</em>
                </div>
                <div className="offer-buy">
                  <b><img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />{lot.price}</b>
                  <button className={`pill${i === 0 ? " pill-primary" : ""}`} disabled={busy} onClick={() => buyLot(lot)}>Купити</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {note && <div className="panel" style={{ borderColor: "var(--accent)", fontWeight: 700 }}>{note}</div>}
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="buy-row">
        <button className="cta" disabled={busy || !price} onClick={buyFromShop}>
          <span className="coins2">
            <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 20, height: 21 }} />
            <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
          </span>
          {price ?? "—"}
        </button>
      </div>
    </div>
  );
}
