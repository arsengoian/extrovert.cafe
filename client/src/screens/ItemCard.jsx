// Картка предмета одягу: спрайт, назва, тір, слот, набір і markdown-опис
// (gamification_ui.md, Склад). Опис рендеримо підмножиною markdown —
// абзаци, жирний, курсив і списки; сирий HTML не показуємо взагалі.
//
// Тут же — лоти інших гравців на цей самий предмет: у дизайні вони лежать
// прямо в прев'ю, і це правильно. Магазинна ціна фіксована, а на маркеті
// та сама річ часто дешевша — ховати це від гравця нечесно.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { renderMarkdown } from "../ui/markdown.jsx";
import { beans as beansWord, coins as coinsWord } from "../ui/plural.js";

const TIER_LABEL = { common: "Звичайний", uncommon: "Незвичайний", rare: "Рідкісний", epic: "Епічний" };
const SLOT_LABEL = { head: "голова", body: "тіло", pants: "штани", feet: "взуття", acc_1: "аксесуар" };
const SET_BEANS = { common: 3, uncommon: 6, rare: 9, epic: 15 };

export function ItemCard({ item, owned, ctx }) {
  const [offers, setOffers] = useState(null);
  const [stock, setStock] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const code = item?.code;
  const load = () => Promise.all([
    api.get(`/market/offers?item=${encodeURIComponent(code)}&limit=3`).then(setOffers).catch(() => setOffers({ offers: [], total: 0 })),
    api.get("/me/items").then((r) => setStock(r.items)).catch(() => setStock([])),
  ]);
  useEffect(() => { if (code) load(); }, [code]);

  if (!item) return null;

  // Скільки слотів комплекту вже закрито: рахуємо за колекцією предмета.
  const sameSet = (stock ?? []).filter((i) => i.collection && i.collection === item.collection);
  const slotsOwned = new Set(sameSet.map((i) => i.slot)).size;

  const buyFromShop = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/shop/buy", { code: "item", item: item.code });
      await ctx.refreshMe();
      setNote(`«${r.name}» на складі.`);
      await load();
    } catch (e) {
      setError(e.body?.error === "not_enough" ? "Не вистачає монет" : e.body?.error ?? e.message);
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
      const code2 = e.body?.error;
      setError(code2 === "already_gone" ? "Лот уже купили" : code2 === "not_enough" ? "Не вистачає монет" : code2 ?? e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const price = item.price_coins;

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <ItemIcon sprite={item.sprite_id} size={140} alt={item.name} name={item.name} />
        <div className="h2" style={{ marginTop: 10 }}>{item.name}</div>
        <div className="row" style={{ justifyContent: "center", gap: 6 }}>
          <span className={`tag tag-${item.tier}`}>{TIER_LABEL[item.tier] ?? item.tier}</span>
          <span className="tag">{SLOT_LABEL[item.slot] ?? item.slot}</span>
          {item.collection ? <span className="tag">{item.collection}</span> : null}
          {item.owned > 1 ? <span className="tag">×{item.owned}</span> : null}
        </div>
      </div>

      {item.description_md ? <div className="panel">{renderMarkdown(item.description_md)}</div> : null}

      {item.collection && (
        <div className="panel muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          У тебе {slotsOwned} з 5 слотів комплекту «{item.collection}». За повний комплект кавенятко дасть{" "}
          {beansWord(SET_BEANS[item.tier] ?? 3)} — рідкість рахується за найслабшим предметом.
        </div>
      )}

      {offers?.offers?.length > 0 && (
        <>
          <div className="row-between" style={{ margin: "18px 4px 8px" }}>
            <span className="sectionTitle" style={{ margin: 0 }}>Від інших гравців</span>
            <span className="muted" style={{ fontSize: 12 }}>усього {offers.total}</span>
          </div>
          {offers.offers.map((lot) => (
            <div key={lot.id} className="panel row" style={{ gap: 10, padding: 10 }}>
              <ItemIcon sprite={lot.item?.sprite_id ?? item.sprite_id} size={40} style={{ width: 40 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{lot.item?.name ?? item.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  продає {lot.seller}
                  {price && lot.currency === "yellow" && lot.price < price ? ` · дешевше за магазин на ${price - lot.price}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="price" style={{ fontSize: 13 }}>
                  {lot.price}<img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
                </div>
                <button className="btn" style={{ width: "auto", height: 30, padding: "0 12px", fontSize: 12, marginTop: 4 }}
                        disabled={busy} onClick={() => buyLot(lot)}>Купити</button>
              </div>
            </div>
          ))}
        </>
      )}

      {note && <div className="panel" style={{ borderColor: "var(--accent)", fontWeight: 700 }}>{note}</div>}
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {owned ? (
          <>
            <button className="btn btn-primary" onClick={() => ctx.push("wearItem", { item })}>Вдягнути</button>
            <button className="btn" disabled={!item.free} onClick={() => ctx.push("sellItem", { item })}>
              {item.free ? "Продати на P2P" : "Вільних копій немає"}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={busy || !price} onClick={buyFromShop}>
            {price ? `Купити за ${coinsWord(price)}` : "Не продається в магазині"}
          </button>
        )}
      </div>
    </div>
  );
}
