// Картка предмета одягу: спрайт, назва, тір, слот, набір і markdown-опис
// (gamification_ui.md, Склад). Опис рендеримо підмножиною markdown —
// абзаци, жирний, курсив і списки; сирий HTML не показуємо взагалі.
import { renderMarkdown } from "../ui/markdown.jsx";

const TIER_LABEL = { common: "Звичайний", uncommon: "Незвичайний", rare: "Рідкісний", epic: "Епічний" };
const SLOT_LABEL = { head: "голова", body: "тіло", pants: "штани", feet: "взуття", acc_1: "аксесуар" };

export function ItemCard({ item, owned, ctx }) {
  if (!item) return null;
  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <img src={`/assets/ui/${item.sprite_id}.png`} alt="" style={{ width: 140, height: 140, objectFit: "contain", margin: "0 auto" }}
             onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        <div className="h2" style={{ marginTop: 10 }}>{item.name}</div>
        <div className="row" style={{ justifyContent: "center", gap: 6 }}>
          <span className={`tag tag-${item.tier}`}>{TIER_LABEL[item.tier] ?? item.tier}</span>
          <span className="tag">{SLOT_LABEL[item.slot] ?? item.slot}</span>
          {item.collection ? <span className="tag">{item.collection}</span> : null}
          {owned && item.owned > 1 ? <span className="tag">×{item.owned}</span> : null}
        </div>
      </div>

      {item.description_md ? (
        <div className="panel">{renderMarkdown(item.description_md)}</div>
      ) : null}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {owned ? (
          <>
            <button className="btn btn-primary" onClick={() => ctx.push("wearItem", { item })}>Вдягнути</button>
            <button className="btn" onClick={() => ctx.push("sellItem", { item })}>Продати на P2P</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => ctx.push("buyItem", { item })}>
            Купити за {item.price_coins} монет
          </button>
        )}
      </div>
    </div>
  );
}
