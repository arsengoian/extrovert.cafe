// Іконки валют. Ціна, яку можна закрити будь-якими монетами, малюється
// парою «срібна + золота» — так у макеті скрізь, де списання йде через
// spendCoins (покупки в крамниці, препарати, скринька, одяг): гравець має
// бачити, що підійдуть обидві. Сама монета одна — там, де валюта строго
// одна (чат платить лише жовтими, набори монет дають лише жовті).
//
// Жило це раніше трьома копіями — у Shop.jsx, ItemCard.jsx і NotEnough.jsx,
// і четверта копія в попапі препаратів уже встигла розійтися: там ціна
// показувалась однією золотою (23.09.2026).

export const Gold = ({ w = 14, h = 15 }) => (
  <img src="/assets/ui/coin_gold.png" alt="золоті монети"
       style={{ width: w, height: h, display: "inline", verticalAlign: -3 }} />
);

export const Silver = ({ w = 14, h = 15 }) => (
  <img src="/assets/ui/coin_silver.png" alt="срібні монети"
       style={{ width: w, height: h, display: "inline", verticalAlign: -3 }} />
);

export const Bean = ({ w = 14, h = 16 }) => (
  <img src="/assets/ui/bean.png" alt="зерна"
       style={{ width: w, height: h, display: "inline", verticalAlign: -3 }} />
);

// size — сторона монети, overlap — на скільки золота заходить на срібну.
export const Coins2 = ({ size = 16, overlap = 7 }) => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: size, height: size + 1 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: size, height: size + 1, marginLeft: -overlap }} />
  </span>
);
