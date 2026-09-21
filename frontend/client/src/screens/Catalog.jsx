// «Весь одяг» — кадр «Магазин · весь одяг»: підказка про подарунок
// комплекту й усі набори підряд — назва, тір, ціна за штуку, п'ять плиток
// кольору тіру й ціна всього комплекту. Ціна рахується з тіру (economy §5.1).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

const TIER_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };
const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

export function Catalog({ ctx }) {
  const [items, setItems] = useState(null);

  useEffect(() => { api.get("/catalog/items").then((r) => setItems(r.items)).catch(() => setItems([])); }, []);

  if (!items) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Порядок наборів і слотів уже задає api — лишається згрупувати.
  const sets = [];
  for (const it of items) {
    const last = sets[sets.length - 1];
    if (last?.name === it.collection) last.items.push(it);
    else sets.push({ name: it.collection, tier: it.tier, items: [it] });
  }

  return (
    <div className="stage-pad" style={{ gap: 16 }}>
      <div className="hint-chip">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" />
        </svg>
        Зібраний комплект можна подарувати кавенятку – воно віддячить кавовими зернами.
      </div>

      {sets.map((set) => {
        const each = set.items[0].price_coins;
        return (
          <div className="set" key={set.name}>
            <div className="set-head">
              <div>
                <b>{set.name}</b>
                <span className={`tag-${set.tier}`}>{TIER_LABEL[set.tier]}</span>
              </div>
              <span className="set-price">
                <img src="/assets/ui/coin_gold.png" alt="золотих монет" />{fmt(each)}<small>/шт</small>
              </span>
            </div>
            <div className="set-tiles">
              {set.items.map((it) => (
                <button key={it.code} className={`set-tile tier-${set.tier}`} onClick={() => ctx.push("itemCard", { item: it })}>
                  <ItemIcon sprite={it.sprite_id} size={50} name={it.name} style={{ width: 53 }} />
                </button>
              ))}
            </div>
            <div className="set-total">
              {/* Сума комплекту в макеті без розділювача тисяч: «2125». */}
              весь комплект <img src="/assets/ui/coin_gold.png" alt="золотих монет" />{each * set.items.length}
            </div>
          </div>
        );
      })}
    </div>
  );
}
