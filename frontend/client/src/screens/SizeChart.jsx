// «Таблиця розмірів» — окремий екран із чекауту: схема футболки з мірками
// A і B, як міряти, таблиця й «Обрати M». Обраний розмір повертається в
// чекаут через onPick.
import { useState } from "react";

export function SizeChart({ chart = {}, selected = null, onPick, ctx }) {
  const [size, setSize] = useState(selected);

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="size-art">
        <svg viewBox="0 0 240 180" width="100%" height="150" fill="none" stroke="var(--ink)" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M78 30 L46 46 L36 76 L60 84 L60 150 L156 150 L156 84 L180 76 L170 46 L138 30" />
          <path d="M78 30 Q108 60 138 30" strokeWidth="2.6" />
          <g stroke="var(--muted)" strokeWidth="1.8" strokeDasharray="5 5">
            <path d="M60 30 L60 46" /><path d="M196 34 L196 154" /><path d="M156 30 L200 30" /><path d="M156 150 L200 150" />
          </g>
          <g stroke="var(--ink)" strokeWidth="2.2">
            <path d="M66 96 L150 96" />
            <path d="M66 96 L73 91 M66 96 L73 101 M150 96 L143 91 M150 96 L143 101" />
            <path d="M196 38 L196 146" />
            <path d="M196 38 L191 45 M196 38 L201 45 M196 146 L191 139 M196 146 L201 139" />
          </g>
          <text x="104" y="116" fill="var(--muted)" stroke="none" fontSize="15" fontFamily="Extro, sans-serif" fontWeight="700">A</text>
          <text x="205" y="98" fill="var(--muted)" stroke="none" fontSize="15" fontFamily="Extro, sans-serif" fontWeight="700">B</text>
        </svg>
      </div>

      <div className="size-how">
        <div>Виміряйте обхват грудей сантиметром або рулеткою. За їх відсутності – ниткою, а потім виміряйте довжину нитки лінійкою.</div>
        <div>Отримане значення поділіть на два – це ваш напівобхват грудей. Щоб футболка сиділа вільно, додайте 2–5 см.</div>
        <div>Довжина вимірюється від плеча до нижнього краю футболки.</div>
      </div>

      <div className="size-table">
        <div className="size-th"><span>Розмір</span><span>Ширина (A)</span><span>Довжина (B)</span></div>
        {Object.entries(chart).map(([s, v]) => (
          <button key={s} className="size-tr" data-on={size === s || undefined} onClick={() => setSize(s)}>
            <b>{s}</b><span>{v.width} см</span><span>{v.length} см</span>
          </button>
        ))}
      </div>

      <button className="cta wide" disabled={!size} onClick={() => { onPick?.(size); ctx.pop(); }}>
        {size ? `Обрати ${size}` : "Обери розмір"}
      </button>
    </div>
  );
}
