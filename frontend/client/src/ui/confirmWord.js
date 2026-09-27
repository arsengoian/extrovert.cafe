// Слово-підтвердження для безповоротних дій («скосити», «видалити»).
// Кнопка не сіріє, поки слова немає: сіра кнопка мовчить, і людина не
// розуміє, чого від неї хочуть. Натомість тап без слова підсвічує поле —
// червона рамка, легкий трус, фокус і підказка під ним (власник,
// 27.09.2026).
import { useRef, useState } from "react";
import { calm } from "./fx.jsx";

const SHAKE = [
  { transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" },
  { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" },
];

export function useConfirmWord(value, word) {
  const ref = useRef(null);
  const [invalid, setInvalid] = useState(false);
  return {
    ref,
    invalid,
    reset: () => setInvalid(false),
    // true — слово на місці, можна діяти; false — поле вже підсвічене.
    ok: () => {
      if (value.trim().toLowerCase() === word) return true;
      setInvalid(true);
      const el = ref.current;
      el?.focus();
      if (el?.animate && !calm()) el.animate(SHAKE, { duration: 360, easing: "ease-out" });
      return false;
    },
  };
}
