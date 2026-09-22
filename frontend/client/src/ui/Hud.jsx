// Топбар з балансами: срібні, жовті, зерна — і три кнопки праворуч.
// Нарахування видно одразу (кадр «Нарахування монет» на дошці анімацій):
// монети летять у свою іконку, а число перебігає до нового значення.
import { useEffect, useRef } from "react";
import { RollingNumber, flyCoins } from "./fx.jsx";

// Монети злітають, коли попап із нагородою вже встиг з'явитись і позначити,
// звідки їм летіти (markCoinSource).
const FLY_AFTER_MS = 250;

function useCoinFlight(value, iconRef, src) {
  const last = useRef(value);
  useEffect(() => {
    const before = last.current;
    last.current = value;
    if (before == null || value == null || value <= before) return undefined;
    const t = setTimeout(() => flyCoins(iconRef.current, src), FLY_AFTER_MS);
    return () => clearTimeout(t);
  }, [value]);
}

export function Hud({ me, onOpen, onSupport }) {
  const b = me?.balances ?? {};
  const silverRef = useRef(null);
  const goldRef = useRef(null);
  useCoinFlight(b.silver, silverRef, "/assets/ui/coin_silver.png");
  useCoinFlight(b.yellow, goldRef, "/assets/ui/coin_gold.png");

  return (
    <div className="hud">
      <div className="hud-pill">
        <span className="hud-val"><img ref={silverRef} src="/assets/ui/coin_silver.png" alt="срібні монети" /><RollingNumber value={b.silver} /></span>
        <span className="hud-val"><img ref={goldRef} src="/assets/ui/coin_gold.png" alt="золоті монети" /><RollingNumber value={b.yellow} /></span>
        <span className="hud-val"><img src="/assets/ui/bean.png" alt="зерна" style={{ width: 20 }} /><RollingNumber value={b.beans} /></span>
      </div>
      <button className="icon-btn" aria-label="Повідомити про проблему" onClick={() => onOpen("problem")}>
        <img src="/assets/ui/nav_problem.png" alt="" style={{ width: 24, height: 23 }} />
      </button>
      <button className="icon-btn" aria-label="Підтримка" onClick={onSupport}>
        <img src="/assets/ui/nav_support.png" alt="" style={{ width: 22, height: 23 }} />
      </button>
      <button className="icon-btn" data-active="true" aria-label="Профіль" onClick={() => onOpen("profile")}>
        <img src="/assets/ui/nav_profile.png" alt="" style={{ width: 20, height: 23 }} />
      </button>
    </div>
  );
}
