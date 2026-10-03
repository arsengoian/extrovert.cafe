// «Весь одяг» — кадр «Магазин · весь одяг»: підказка про подарунок
// комплекту й усі набори підряд — назва, тір, ціна за штуку, п'ять плиток
// кольору тіру й ціна всього комплекту. Ціна рахується з тіру (economy §5.1).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { LoadFailed } from "../ui/Net.jsx";
import { Coins2 } from "../ui/Coins.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";

const TIER_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };
const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

// Ряд плиток їде вбік, і край підтирається лише з того боку, куди ще є що
// гортати (власник, 03.10.2026): справа — поки не догорнув до кінця, зліва —
// щойно зрушив. Досі маска стояла справа завжди, навіть у кінці ряду.
function SetTiles({ children }) {
  const row = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    const update = () => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  return <div ref={row} className="set-tiles" data-fade={[edge.l && "l", edge.r && "r"].filter(Boolean).join(" ") || undefined}>{children}</div>;
}

// Повернення з картки предмета — на те саме місце списку (власник,
// 03.10.2026), і лише тоді. Каталог при цьому монтується наново (.stage має
// key екрана, app.jsx), тож позицію тримаємо тут і прив'язуємо до візиту:
// Shop кладе в props мітку visit, «Назад» повертає той самий запис стеку з
// тією самою міткою, а новий вхід у каталог — це нова мітка й верх списку.
let back = null; // { visit, y }

export function Catalog({ ctx, visit }) {
  const [items, setItems] = useState(() => api.peek("/catalog/items")?.items ?? null);
  const root = useRef(null);

  const [failed, setFailed] = useState(false);
  const load = () => api.get("/catalog/items").then((r) => { setFailed(false); setItems(r.items); }).catch(() => setFailed(true));
  useEffect(() => { load(); }, []);
  useLayoutEffect(() => {
    if (!items || !back) return;
    if (visit != null && back.visit === visit && root.current?.parentElement) root.current.parentElement.scrollTop = back.y;
    back = null;
  }, [items]);
  const open = (item) => {
    back = { visit, y: root.current?.parentElement?.scrollTop ?? 0 };
    ctx.push("itemCard", { item });
  };

  if (!items) return failed ? <LoadFailed onRetry={() => { setFailed(false); load(); }} /> : <div className="stage-pad"><div className="skeleton" /></div>;

  // Порядок наборів і слотів уже задає api — лишається згрупувати.
  const sets = [];
  for (const it of items) {
    const last = sets[sets.length - 1];
    if (last?.name === it.collection) last.items.push(it);
    else sets.push({ name: it.collection, tier: it.tier, items: [it] });
  }

  return (
    <div className="stage-pad" style={{ gap: 16 }} ref={root}>
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
                <Coins2 size={15} overlap={6} />{fmt(each)}<small>/шт</small>
              </span>
            </div>
            <SetTiles>
              {set.items.map((it) => (
                <button key={it.code} className={`set-tile tier-${set.tier}`} onClick={() => open(it)}>
                  <ItemIcon sprite={it.sprite_id} size={50} name={it.name} style={{ width: 53 }} />
                </button>
              ))}
            </SetTiles>
            <div className="set-total">
              {/* Сума комплекту в макеті без розділювача тисяч: «2125». */}
              весь комплект <Coins2 size={15} overlap={6} />{each * set.items.length}
            </div>
          </div>
        );
      })}
    </div>
  );
}
