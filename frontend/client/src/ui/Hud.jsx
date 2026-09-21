// Топбар з балансами: срібні, жовті, зерна — і три кнопки праворуч.
const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

export function Hud({ me, onOpen }) {
  const b = me?.balances ?? {};
  return (
    <div className="hud">
      <div className="hud-pill">
        <span className="hud-val"><img src="/assets/ui/coin_silver.png" alt="срібні монети" />{fmt(b.silver)}</span>
        <span className="hud-val"><img src="/assets/ui/coin_gold.png" alt="золоті монети" />{fmt(b.yellow)}</span>
        <span className="hud-val"><img src="/assets/ui/bean.png" alt="зерна" style={{ width: 20 }} />{fmt(b.beans)}</span>
      </div>
      <button className="icon-btn" aria-label="Повідомити про проблему" onClick={() => onOpen("problem")}>
        <img src="/assets/ui/nav_problem.png" alt="" style={{ width: 24, height: 23 }} />
      </button>
      <button className="icon-btn" aria-label="Підтримка" onClick={() => onOpen("support")}>
        <img src="/assets/ui/nav_support.png" alt="" style={{ width: 22, height: 23 }} />
      </button>
      <button className="icon-btn" data-active="true" aria-label="Профіль" onClick={() => onOpen("profile")}>
        <img src="/assets/ui/nav_profile.png" alt="" style={{ width: 20, height: 23 }} />
      </button>
    </div>
  );
}
