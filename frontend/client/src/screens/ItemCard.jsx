// Превʼю одягу — кадр «Превʼю одягу»: предмет у сяйві, назва з чипом
// тіру, опис і що дасть комплект, лоти інших гравців і ціна магазину.
// Лоти лежать прямо в превʼю, як у макеті: на маркеті та сама річ часто
// дешевша, і ховати це від гравця нечесно.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { renderMarkdown } from "../ui/markdown.jsx";
import { NotEnoughBeans, NotEnoughCoins } from "../ui/NotEnough.jsx";
import { ResultPopup } from "../ui/Popup.jsx";
import { BuyConfirm } from "../ui/BuyConfirm.jsx";

export const TIER_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };
export const SLOT_OF = { head: "слот голови", body: "слот тіла", pants: "слот штанів", feet: "слот взуття", acc_1: "слот аксесуара" };
// Зерна за комплект приходять з api (catalog: set_beans, з economy.json).
// Це лише запас для предметів, що прийшли не з каталогу, — тримати в
// синхроні з set.beans_by_tier (01.10.2026: Epic 17).
const SET_BEANS = { common: 3, uncommon: 6, rare: 9, epic: 17 };

export function ItemCard({ item, ctx }) {
  const [offers, setOffers] = useState(null);
  const [stock, setStock] = useState(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Підтвердження перед покупкою: { lot } — лот на ринку, {} — у кафе
  // (власник, 01.10.2026).
  const [confirm, setConfirm] = useState(null);

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
  const owned = (stock ?? []).find((i) => i.code === item.code)?.owned ?? 0;

  // Успіх — попапом, а не рядком під кнопкою: рядок легко проґавити, а
  // кнопка лишалась під пальцем — і людина купувала ту саму річ удруге й
  // утретє (власник, 27.09.2026). Попап перериває, а плашка «уже на
  // складі» над кнопкою лишається й після нього.
  const bought = (text) => {
    const close = () => ctx.notify(null);
    ctx.notify(
      <ResultPopup art={<ItemIcon sprite={item.sprite_id} size={62} alt={item.name} style={{ width: 62 }} />}
                   title="Готово" action="На склад" onAction={() => { close(); ctx.openTab("stock"); }} onClose={close}>
        <div className="result-note">{text}</div>
      </ResultPopup>
    );
  };

  const short = (need) => {
    const b = ctx.me?.balances ?? {};
    ctx.notify(<NotEnoughCoins what={item.name} price={need} have={(b.silver ?? 0) + (b.yellow ?? 0)} ctx={ctx} onClose={() => ctx.notify(null)} />);
  };

  const buyFromShop = async () => {
    setBusy(true);
    setError(null);
    setConfirm(null);
    try {
      const r = await api.post("/shop/buy", { code: "item", item: item.code });
      await ctx.refreshMe();
      await load();
      bought(`«${r.name}» уже на складі.`);
    } catch (e) {
      if (e.body?.error === "not_enough") short(price);
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const buyLot = async (lot) => {
    setBusy(true);
    setError(null);
    setConfirm(null);
    try {
      await api.post(`/market/listings/${lot.id}/buy`);
      await ctx.refreshMe();
      await load();
      bought(`Куплено в ${lot.seller} за ${lot.price}. «${lot.item?.name ?? item.name}» уже на складі.`);
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
          <span>{SLOT_OF[item.slot] ?? item.slot}{item.collection ? `, комплект «${item.collection}»` : ""}</span>
        </div>
      </div>

      <div className="item-text">
        {item.description_md ? renderMarkdown(item.description_md) : null}
        {item.collection && (
          <div>
            {/* Без двокрапки й пояснення про найслабший предмет
                (власник, 27.09.2026). */}
            У тебе вже {slotsOwned} з 5 предметів комплекту. За повний комплект кавенятко дасть {item.set_beans ?? SET_BEANS[item.tier] ?? 3}{" "}
            <img src="/assets/ui/bean.webp" alt="кавових зерна" />
          </div>
        )}
      </div>

      {offers?.offers?.length > 0 && (
        <div className="offers">
          <div className="section-head" style={{ alignItems: "baseline" }}>
            <div className="sectionTitle">Від інших користувачів</div>
            {offers.total > offers.offers.length && (
              <button className="link-more" data-tap="off" onClick={() => setAll(true)}>усі {offers.total} лотів</button>
            )}
          </div>
          {offers.offers.map((lot, i) => {
            return (
              <div key={lot.id} className="offer">
                <span className={`offer-tile tier-${lot.item?.tier ?? item.tier}`}>
                  <ItemIcon sprite={lot.item?.sprite_id ?? item.sprite_id} size={36} style={{ width: 36 }} />
                </span>
                <div className="offer-main">
                  <b>{lot.item?.name ?? item.name}</b>
                  <small>продає {lot.seller}</small>
                  {/* Без «дешевше за магазин на…» (власник, 02.10.2026): ціну видно й так. */}
                  <em>{`${tierOf(lot.item?.tier ?? item.tier)}, ${(SLOT_OF[lot.item?.slot ?? item.slot] ?? "").toLowerCase()}`}</em>
                </div>
                <div className="offer-buy">
                  <b><img src={lot.currency === "beans" ? "/assets/ui/bean.webp" : "/assets/ui/coin_gold.webp"} alt="" />{lot.price}</b>
                  <button className={`pill${i === 0 ? " pill-primary" : ""}`} disabled={busy} onClick={() => setConfirm({ lot })}>Купити</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {owned > 0 && (
        <div className="owned-note">
          <b>Уже на складі: {owned} шт</b>
          <span>Ще одна така річ піде в дублі – її можна продати на ринку.</span>
        </div>
      )}
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      {confirm && (() => {
        const lot = confirm.lot;
        return (
          <BuyConfirm art={<ItemIcon sprite={lot?.item?.sprite_id ?? item.sprite_id} size={112} alt={item.name} style={{ width: 112 }} />}
                      title={lot?.item?.name ?? item.name}
                      price={lot ? lot.price : price} currency={lot ? (lot.currency === "beans" ? "beans" : "yellow") : "coins"}
                      balances={ctx.me?.balances} busy={busy} onCancel={() => setConfirm(null)}
                      onBuy={() => (lot ? buyLot(lot) : buyFromShop())} />
        );
      })()}

      <div className="buy-row">
        <button className="cta" disabled={busy || !price} onClick={() => setConfirm({})}>
          <span className="coins2">
            <img src="/assets/ui/coin_silver.webp" alt="срібні монети" style={{ width: 20, height: 21 }} />
            <img src="/assets/ui/coin_gold.webp" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
          </span>
          {price ?? "—"}
        </button>
      </div>
    </div>
  );
}
