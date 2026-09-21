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

// art — картинка в сяйві над заголовком; decor — абсолютний фон картки
// (сяйво скриньки); onAction — якщо головна кнопка робить щось інше, ніж
// просто закрити («На склад»); side — відступ картки від країв.
export function ResultPopup({ art, glow = 96, decor, title, children, action = "Готово", onAction, onClose, offset = 110, side = 18, gap }) {
  const top = useStageTop(offset);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="result-card" style={{ top, left: side, right: side, gap }}>
        {decor}
        {art && <div className="result-glow" style={{ width: glow, height: glow }}>{art}</div>}
        <div className="result-title">{title}</div>
        {children}
        {action && <button className="cta wide" onClick={onAction ?? onClose}>{action}</button>}
      </div>
    </>,
    host
  );
}

// Шторка — картка на 14 px від низу сцени, над нижнім меню (кадр «Попап ·
// оплата mono pay»), а не поверх нього.
export function useStageBottom(offset) {
  const [bottom, setBottom] = useState(offset);
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    const stage = document.querySelector(".stage");
    if (app && stage) setBottom(app.getBoundingClientRect().bottom - stage.getBoundingClientRect().bottom + offset);
  }, [offset]);
  return bottom;
}

// closable — кругла «×» у куті, як у «Попап · не вистачає монет».
export function ConfirmSheet({ children, onCancel, closable = false, gap, padding }) {
  const bottom = useStageBottom(14);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="confirm-sheet" style={{ bottom, gap, padding }}>
        {closable && (
          <button className="sheet-x" title="Закрити" aria-label="Закрити" onClick={onCancel}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
            </svg>
          </button>
        )}
        {children}
      </div>
    </>,
    host
  );
}
