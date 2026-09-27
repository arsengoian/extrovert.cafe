// Ландшафт — телефон на боці й десктоп (рішення власника 27.09.2026): шапка
// й нижнє меню стають смугами зліва й справа, полотно між ними скролиться
// вертикально, попапи стають картками посередині.
//
// Запит один на весь застосунок; той самий рядок стоїть у theme.css
// (розділ «ландшафт»). min-width відсікає телефон у портреті з клавіатурою:
// вікно там теж буває ширшим за висоту, а міняти верстку під пальцями не
// можна. Клавіатура макет і так не стискає (interactive-widget у
// index.html), але вузьке десктопне вікно лишається портретною колонкою.
import { useEffect, useState } from "react";

export const LANDSCAPE = "(orientation: landscape) and (min-width: 560px)";

const query = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(LANDSCAPE) : null);

export const isLandscape = () => Boolean(query()?.matches);

export function useLandscape() {
  const [on, setOn] = useState(isLandscape);
  useEffect(() => {
    const mq = query();
    if (!mq) return undefined;
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on;
}
