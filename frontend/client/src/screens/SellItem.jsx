// «Продати одяг» — кадр «P2P · продаж одягу»: предмет, ціна лише в
// золотих монетах (зерна приглушені), комісія й мінімум, схожі лоти зараз,
// як працює продаж і «Виставити на маркет».
//
// Маркет не показує лоти списком — він пропонує вибірку, і дешевші лоти
// потрапляють у неї частіше (services.md §4); звідси й підказка про ціну.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { plural } from "../ui/plural.js";
import { SLOT_OF, TIER_LABEL } from "./ItemCard.jsx";

const Gold = ({ w = 14, h = 15 }) => <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: w, height: h }} />;
const freeWord = (n) => (n === 1 ? "одна вільна" : `${n} ${plural(n, "вільна", "вільні", "вільних")}`);

export function SellItem({ item, ctx }) {
  const [price, setPrice] = useState(String(item?.price_coins ?? 60));
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/market/rules?item=${encodeURIComponent(item.code)}`).then(setRules).catch(() => setRules({}));
  }, [item.code]);

  const pct = rules?.commission_pct?.item ?? 10;
  const min = rules?.min_price?.yellow ?? 10;
  const value = Math.trunc(Number(price) || 0);
  const commission = Math.round((value * pct) / 100);
  const similar = rules?.similar;

  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/market/listings", { kind: "item", user_item_id: item.user_item_id, price: value, currency: "yellow" });
      ctx.replace("listings");
    } catch (e) {
      const code = e.body?.error;
      setError(code === "item_locked" ? "Річ замкнена в подарованому комплекті"
        : code === "item_in_set" ? "Річ зараз одягнена – спершу зніми її"
        : code === "already_listed" ? "Ця копія вже на продажу"
        : code === "price_too_low" ? `Мінімальна ціна – ${min}`
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="sell-card">
        <span className={`sell-tile tier-${item.tier}`}>
          <ItemIcon sprite={item.sprite_id} size={40} name={item.name} style={{ width: 50 }} />
        </span>
        <div className="lot-body">
          <b className="sell-name">{item.name}</b>
          <strong className={`tier-text tier-${item.tier}`}>{TIER_LABEL[item.tier]} · {SLOT_OF[item.slot]}</strong>
          <small className="sell-stock">на складі {item.owned ?? 1} · {freeWord(item.free ?? 0)}</small>
        </div>
      </div>

      <div className="field" style={{ gap: 10 }}>
        <div className="sectionTitle">Ціна</div>
        {/* Одяг продається лише за золоті — зерна показані, але вимкнені. */}
        <div className="seg">
          <button data-on="true"><Gold w={16} h={17} /></button>
          <button disabled style={{ opacity: 0.4 }}><img src="/assets/ui/bean.png" alt="кавові боби" style={{ width: 15, height: 17 }} /></button>
        </div>
        <label className="sell-price">
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <span>комісія {pct}% · {commission} <Gold /></span>
        </label>
        <div className="sell-note">Одяг продається лише за <Gold w={13} h={14} />. Мінімальна ціна – {min}.</div>
        {similar && (
          <div className="sell-similar">
            <span>Схожі лоти зараз</span>
            <b>{similar.min === similar.max ? similar.min : `${similar.min}-${similar.max}`} <Gold w={15} h={16} /></b>
          </div>
        )}
      </div>

      <div className="why sell">
        <b>Як працює продаж</b>
        <p>Предмет заморожується на складі до продажу: вдягнути або подарувати його неможливо. Поки не купили – можна зняти з продажу.</p>
        <p>Подарований кавенятку одяг продати не можна – він іде разом із кавенятком.</p>
        <p>Комісія до {pct}% у валюті угоди повністю згорає – анти-аб'юз, не монетизація.</p>
        <p>Твій лот показують поруч із тим самим товаром від кафе, і чим дешевший він за сусідів, тим частіше його бачать покупці. Якщо хочеш, щоб купили швидко, став ціну в нижній частині діапазону і дешевше, ніж продає кафе.</p>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" style={{ marginTop: "auto", height: 52 }} disabled={busy || !item.free || value < min} onClick={list}>
        Виставити на маркет
      </button>
    </div>
  );
}
