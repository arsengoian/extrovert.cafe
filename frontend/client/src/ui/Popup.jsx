// Попапи з макета: картка-результат із сяйвом («Переказ виконано»,
// «Монети зараховано») і нижня шторка-підтвердження («Оплата mono pay»).
// Обидві — поверх усього застосунку з розмитим фоном: HUD і нижнє меню
// теж ідуть під розмиття, як у макеті.
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

// Картка стоїть на фіксованій відстані від верху тіла екрана, а не
// посередині: так у макеті (top 96–110 від початку контенту), і так її не
// перекриває клавіатура на коротких телефонах.
function useStageTop(offset) {
  const [top, setTop] = useState(offset);
  useLayoutEffect(() => {
    const stage = document.querySelector(".stage");
    if (stage) setTop(stage.offsetTop + offset);
  }, [offset]);
  return top;
}

export function ResultPopup({ art, glow = 96, title, children, action = "Готово", onClose, offset = 110 }) {
  const top = useStageTop(offset);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="result-card" style={{ top }}>
        <div className="result-glow" style={{ width: glow, height: glow }}>{art}</div>
        <div className="result-title">{title}</div>
        {children}
        <button className="cta wide" onClick={onClose}>{action}</button>
      </div>
    </>,
    host
  );
}

// Шторка — картка на 14 px від низу сцени, над нижнім меню (кадр «Попап ·
// оплата mono pay»), а не поверх нього.
function useStageBottom(offset) {
  const [bottom, setBottom] = useState(offset);
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    const stage = document.querySelector(".stage");
    if (app && stage) setBottom(app.getBoundingClientRect().bottom - stage.getBoundingClientRect().bottom + offset);
  }, [offset]);
  return bottom;
}

export function ConfirmSheet({ children, onCancel }) {
  const bottom = useStageBottom(14);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="confirm-sheet" style={{ bottom }}>{children}</div>
    </>,
    host
  );
}
