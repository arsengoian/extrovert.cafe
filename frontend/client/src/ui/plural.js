// Українська множина: 1 зерно, 2-4 зерна, 5+ зерен. Потрібна скрізь, де в
// текст підставляється число, — інакше вилазить «+3 зерен».
export function plural(n, one, few, many) {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const beans = (n) => `${n} ${plural(n, "зерно", "зерна", "зерен")}`;
export const items = (n) => `${n} ${plural(n, "предмета", "предметів", "предметів")}`;
export const days = (n) => `${n} ${plural(n, "день", "дні", "днів")}`;
export const coins = (n) => `${n} ${plural(n, "монета", "монети", "монет")}`;
