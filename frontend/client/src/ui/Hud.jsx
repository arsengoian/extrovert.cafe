// Топбар з балансами: срібні, жовті, зерна — і три кнопки праворуч.
// Нарахування видно одразу (кадр «Нарахування монет» на дошці анімацій):
// монети летять у свою іконку, а число перебігає до нового значення.
import { useEffect, useRef } from "react";
import { RollingNumber, flyCoins } from "./fx.jsx";

// Монети злітають, коли попап із нагородою вже встиг з'явитись і позначити,
// звідки їм летіти (markCoinSource).
const FLY_AFTER_MS = 250;

function useCoinFlight(value, iconRef, src, opts) {
  const last = useRef(value);
  useEffect(() => {
    const before = last.current;
    last.current = value;
    if (before == null || value == null || value <= before) return undefined;
    const t = setTimeout(() => flyCoins(iconRef.current, src, 6, opts), FLY_AFTER_MS);
    return () => clearTimeout(t);
  }, [value]);
}

export function Hud({ me, onOpen, onWallet, onSupport }) {
  const b = me?.balances ?? {};
  const silverRef = useRef(null);
  const goldRef = useRef(null);
  const beanRef = useRef(null);
  useCoinFlight(b.silver, silverRef, "/assets/ui/coin_silver.webp");
  useCoinFlight(b.yellow, goldRef, "/assets/ui/coin_gold.webp");
  // Зерна летять лише звідти, де їх позначили джерелом, — з бочки після
  // подарованого комплекту (Plant.jsx).
  useCoinFlight(b.beans, beanRef, "/assets/ui/bean.webp", { onlyFromSource: true });

  return (
    <div className="hud">
      {/* Плашка з балансами — кнопка: дивишся на числа, тиснеш на них і
          потрапляєш у гаманець, де вони розписані. Іконки праворуч мають
          свої дії, тому в кнопку загорнута саме плашка, а не весь топбар
          (прохання власника 26.09.2026). Гаманець — вкладка, тож саме
          перемикаємо на неї: відкритий поверх як окремий екран, він мав
          порожній заголовок, а в меню світилась попередня вкладка. */}
      <button className="hud-pill" aria-label="Гаманець" onClick={onWallet}>
        <span className="hud-val"><img ref={silverRef} src="/assets/ui/coin_silver.webp" alt="срібні монети" /><RollingNumber value={b.silver} /></span>
        <span className="hud-val"><img ref={goldRef} src="/assets/ui/coin_gold.webp" alt="золоті монети" /><RollingNumber value={b.yellow} /></span>
        <span className="hud-val"><img ref={beanRef} src="/assets/ui/bean.webp" alt="зерна" style={{ width: 20 }} /><RollingNumber value={b.beans} /></span>
      </button>
      <button className="icon-btn" aria-label="Повідомити про проблему" onClick={() => onOpen("problem")}>
        <img src="/assets/ui/nav_problem.webp" alt="" style={{ width: 24, height: 23 }} />
      </button>
      <button className="icon-btn" aria-label="Підтримка" onClick={onSupport}>
        <img src="/assets/ui/nav_support.webp" alt="" style={{ width: 22, height: 23 }} />
      </button>
      <button className="icon-btn" data-active="true" aria-label="Профіль" onClick={() => onOpen("profile")}>
        <img src="/assets/ui/nav_profile.webp" alt="" style={{ width: 20, height: 23 }} />
      </button>
    </div>
  );
}
