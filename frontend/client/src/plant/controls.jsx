// Дрібні елементи керування екрана посадки: лічильник, диск повороту,
// повзунки розміру й порядку, скіни, пункти «як це працює». Винесені окремо,
// бо однакові для листя, гілок і бутонів — різняться лише межі й підписи.
import { useRef } from "react";

const OK = "#3FBF6F";
const LOW = "#FF4D5E";

// Лічильник у кутку сцени. Для фонового листя — шкала 0…max з позначкою
// мінімуму (кадр «Листя · фон»), для решти — крапки на кожен елемент.
// minLabel — «мін 2» поруч із крапками (гілки).
export function CounterChip({ icon, iconSize, count, max, min = 0, bar, minLabel }) {
  const color = count >= min ? OK : LOW;
  const pct = (n) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="pl-chip">
      <img src={icon} alt="" style={{ width: iconSize, height: iconSize }} />
      {bar ? (
        <>
          <div className="pl-count bar"><b style={{ color }}>{count}</b><span>/ {max}</span></div>
          <div className="pl-scale">
            <div className="pl-track">
              <i style={{ width: pct(count), background: color }} />
              {min > 0 && <em style={{ left: pct(min) }} />}
            </div>
            <div className="pl-legend">
              <span style={{ left: 0 }}>0</span>
              {min > 0 && <span style={{ left: pct(min), transform: "translateX(-50%)" }}>{min}</span>}
              <span style={{ left: "100%", transform: "translateX(-100%)" }}>{max}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="pl-dots-col">
          <div className="pl-count"><b style={{ color }}>{count}</b><span>/ {max}</span></div>
          <div className="pl-dots">
            {Array.from({ length: max }, (_, i) => <i key={i} style={i < count ? { background: color } : undefined} />)}
          </div>
        </div>
      )}
      {minLabel && <small className="pl-min">мін {min}</small>}
    </div>
  );
}

// Кут → точка на колі диска: 0° — вгору, за годинниковою стрілкою.
const at = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [+(32 + r * Math.sin(a)).toFixed(1), +(32 - r * Math.cos(a)).toFixed(1)];
};

// Диск повороту: дозволений сектор — акцентом, решта кола — червоним. Для
// листя переднього плану кут вільний, і акцентом усе коло.
export function Dial({ value, min, max, onChange }) {
  const ref = useRef(null);
  const full = max - min >= 359;

  const fromPointer = (e) => {
    const box = ref.current.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + 39);
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (full) a = (a + 360) % 360;
    onChange(Math.round(Math.max(min, Math.min(max, a))));
  };

  const [x1, y1] = at(min, 29);
  const [x2, y2] = at(max, 29);
  const [nx, ny] = at(value, 24);
  const sign = full ? "" : value > 0 ? "+" : value < 0 ? "−" : "";

  return (
    <div className="pl-dial" ref={ref}
         onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* пусте */ } fromPointer(e); }}
         onPointerMove={(e) => { if (e.buttons) fromPointer(e); }}>
      <svg viewBox="0 0 64 64" width="78" height="78">
        <circle cx="32" cy="32" r="29" fill="none" stroke="var(--panel2)" strokeWidth="6" />
        {full ? (
          <circle cx="32" cy="32" r="29" fill="none" stroke="var(--accent)" strokeWidth="6" opacity=".85" />
        ) : (
          <>
            <path d={`M${x2} ${y2}A29 29 0 1 1 ${x1} ${y1}`} fill="none" stroke="rgba(255,77,94,.5)" strokeWidth="6" strokeLinecap="round" />
            <path d={`M${x1} ${y1}A29 29 0 0 1 ${x2} ${y2}`} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" />
          </>
        )}
        <line x1="32" y1="32" x2={nx} y2={ny} stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="32" cy="32" r="3.4" fill="var(--ink)" />
      </svg>
      <b>{sign}{Math.abs(value)}°</b>
      <small>{full ? "0–359°" : `±${max}°`}</small>
    </div>
  );
}

// Повзунок у стилі макета: доріжка 4 px, заливка градієнтом, біла кнопка.
function Slider({ pct, onPick }) {
  const ref = useRef(null);
  const pick = (e) => {
    const box = ref.current.getBoundingClientRect();
    onPick(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
  };
  return (
    <div className="pl-slider" ref={ref}
         onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* пусте */ } pick(e); }}
         onPointerMove={(e) => { if (e.buttons) pick(e); }}>
      <div className="pl-rail" />
      <div className="pl-fill" style={{ width: `${pct}%` }} />
      <div className="pl-knob" style={{ left: `${pct}%` }} />
    </div>
  );
}

export function RangeRow({ label, value, display, min, max, step = 0.01, onChange }) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  return (
    <div className="pl-range">
      <div className="pl-range-head"><span>{label}</span><b>{display}</b></div>
      <Slider pct={pct} onPick={(t) => onChange(Math.round((min + t * (max - min)) / step) * step)} />
    </div>
  );
}

// Порядок серед своїх: пізніше посаджений малюється поверх, тому «спереду» —
// це кінець масиву (docs/bush_planting_ui.md §7). offset — уже посаджені
// раніше (бутони попередніх стадій): вони ззаду, і рахунок іде після них;
// of — скільки їх буде всього (бутонів — сім за життя).
export function ZOrderRow({ index, total, offset = 0, of, onChange }) {
  const all = of ?? offset + total;
  const pct = Math.round(((offset + index + 1) / all) * 100);
  return (
    <div className="pl-range">
      <div className="pl-range-head"><span>Позиція відносно інших</span><b>{offset + index + 1} з {all}</b></div>
      <Slider pct={pct} onPick={(t) => onChange(Math.max(0, Math.min(total - 1, Math.round(t * all) - 1 - offset)))} />
      <div className="pl-range-ends"><span>ззаду</span><span>спереду</span></div>
    </div>
  );
}

// Скіни листя — два ряди плиток 56×56 (п’ять і решта), гілок — один ряд
// широких плиток.
export function SkinGrid({ count, value, onChange, src, wide }) {
  const tile = (n) => (
    <button key={n} className="pl-skin" data-on={n === value || undefined} onClick={() => onChange(n)}>
      <img src={src(n)} alt={`скін ${n}`} />
    </button>
  );
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if (wide) return <div className="pl-skins wide">{all.map(tile)}</div>;
  return (
    <>
      <div className="pl-skins">{all.slice(0, 5).map(tile)}</div>
      {count > 5 && <div className="pl-skins">{all.slice(5).map(tile)}</div>}
    </>
  );
}

export function Steps({ items }) {
  return (
    <div className="pl-bullets">
      {items.map((text) => <div key={text}><i /><span>{text}</span></div>)}
    </div>
  );
}
