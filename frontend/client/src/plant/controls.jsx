// Дрібні елементи керування екрана посадки: лічильник, диск повороту,
// повзунки розміру й порядку, сітка скінів. Винесені окремо, бо однакові
// для листя, гілок і бутонів — різняться лише межі й підписи.
import { useRef } from "react";

// Лічильник у кутку сцени: скільки вже поставлено і скільки треба.
export function CounterChip({ icon, count, max, min, label, dots }) {
  return (
    <div className="plant-chip">
      <div className="row" style={{ gap: 9 }}>
        <img src={icon} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 3, alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 900 }}>{count}</span>
            <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>/ {max}</span>
          </div>
          {dots ? (
            <div className="plant-dots">
              {Array.from({ length: max }, (_, i) => <i key={i} className={i < count ? "on" : ""} />)}
            </div>
          ) : (
            <>
              <div className="plant-bar">
                <div style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
                {min ? <b style={{ left: `${(min / max) * 100}%` }} /> : null}
              </div>
              <div className="plant-bar-legend"><span>0</span>{min ? <span>{min}</span> : null}<span>{max}</span></div>
            </>
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginTop: 6 }}>{label}</div>
    </div>
  );
}

// Диск повороту: 0° — «як лежить нормаль», тому стрілка вгору, а дозволений
// сектор підсвічений. Для листя переднього плану сектор — усе коло.
export function Dial({ value, min, max, onChange, hint }) {
  const ref = useRef(null);
  const full = max - min >= 359;

  const fromPointer = (e) => {
    const box = ref.current.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    // 0° — вгору, за годинниковою стрілкою.
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (full) a = (a + 360) % 360;
    onChange(Math.round(Math.max(min, Math.min(max, a))));
  };

  const arc = (from, to) => {
    const p = (deg) => {
      const r = ((deg - 90) * Math.PI) / 180;
      return `${(32 + 29 * Math.cos(r)).toFixed(1)} ${(32 + 29 * Math.sin(r)).toFixed(1)}`;
    };
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M${p(from)}A29 29 0 ${large} 1 ${p(to)}`;
  };

  const needle = ((value - 90) * Math.PI) / 180;

  return (
    <div className="plant-dial" ref={ref}
         onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
         onPointerMove={(e) => { if (e.buttons) fromPointer(e); }}>
      <svg viewBox="0 0 64 64" width="78" height="78">
        <circle cx="32" cy="32" r="29" fill="none" stroke="var(--panel2)" strokeWidth="6" />
        {!full && <path d={arc(max, min + 360)} fill="none" stroke="rgba(255,77,94,.5)" strokeWidth="6" strokeLinecap="round" />}
        <path d={full ? arc(0, 359.9) : arc(min, max)} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" />
        <line x1="32" y1="32" x2={32 + 23.5 * Math.cos(needle)} y2={32 + 23.5 * Math.sin(needle)}
              stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="32" cy="32" r="3.4" fill="var(--ink)" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{value > 0 && !full ? "+" : ""}{value}°</div>
      <div className="muted" style={{ fontSize: 11 }}>{hint}</div>
    </div>
  );
}

export function RangeRow({ label, value, display, min, max, step = 0.01, onChange }) {
  return (
    <div className="plant-range">
      <div className="row-between" style={{ fontSize: 12 }}>
        <span className="muted" style={{ fontWeight: 700 }}>{label}</span>
        <span style={{ fontWeight: 800 }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

// Порядок серед своїх: пізніше посаджений малюється поверх, тому «спереду» —
// це кінець масиву (docs/bush_planting_ui.md §7).
export function ZOrderRow({ index, total, onChange }) {
  if (total < 2) return null;
  return (
    <div className="plant-range">
      <div className="row-between" style={{ fontSize: 12 }}>
        <span className="muted" style={{ fontWeight: 700 }}>Позиція відносно інших</span>
        <span style={{ fontWeight: 800 }}>{index + 1} з {total}</span>
      </div>
      <input type="range" min={1} max={total} step={1} value={index + 1}
             onChange={(e) => onChange(Number(e.target.value) - 1)} />
      <div className="plant-bar-legend"><span>ззаду</span><span>спереду</span></div>
    </div>
  );
}

export function SkinGrid({ count, value, onChange, src }) {
  return (
    <div className="skin-grid">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <button key={n} className={`skin-cell${n === value ? " on" : ""}`} onClick={() => onChange(n)}>
          <img src={src(n)} alt={`скін ${n}`} />
        </button>
      ))}
    </div>
  );
}

export function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((text, i) => (
        <li key={text}>
          <span className="steps-num">{i + 1}</span>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{text}</div>
        </li>
      ))}
    </ol>
  );
}
