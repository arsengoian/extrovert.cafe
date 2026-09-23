// Графіки адмінки: смужка-пульс, лінія й стовпчики. Вони живуть окремо від
// решти UI навмисно — це єдине місце, де є арифметика координат, і його
// правлять інакше, ніж картки й таблиці: спершу міряють, потім рухають
// (questions.md, питання 8 — власник попросив тримати це інкапсульованим).
//
// Бібліотеки тут немає й не треба: три примітиви в SVG важать менше, ніж
// будь-який чарт-пакет, і не тягнуть у збірку свою модель даних.
import { useEffect, useRef, useState } from "react";
import { Dot, Empty, fmt } from "./ui.jsx";

// Смужка пульсу: рядок «1/0/?» на півгодинне відро (api віддає саме так).
export function Beat({ history, title }) {
  const line = history?.line ?? "";
  const step = history?.step ?? 1800_000;
  const from = history?.from ?? 0;
  const fails = new Map((history?.fails ?? []).map((f) => [f.t, f.detail]));
  return (
    <div className="beat" title={title}>
      {[...line].map((c, i) => {
        const t = from + i * step;
        const detail = fails.get(t);
        const when = new Date(t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return <i key={i} data-s={c} title={c === "?" ? `${when}: проб не було` : c === "1" ? `${when}: усе гаразд` : `${when}: ${detail ?? "падало"}`} />;
      })}
    </div>
  );
}

// ms — середня затримка проби за останнє відро; у компонентів без HTTP
// (черга outbox, heartbeat) її немає, і тоді колонка просто порожня.
export const BeatRow = ({ ok, name, note, value, history, ms = null }) => (
  <div className="beat-row">
    <span className="name"><Dot ok={ok} />{name}</span>
    <Beat history={history} title={note} />
    {ms !== null && <span className="ms">{fmt.int(ms)} мс</span>}
    <span className="value">{value}</span>
  </div>
);

// Лінійний графік: кілька рядів, спільна шкала. Пусті дані — чесний підпис,
// а не порожня сітка.
export function Line({ series, height = 150, format = fmt.int }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const points = series.flatMap((s) => s.points);
  const has = points.length > 0;
  const max = Math.max(1, ...points.map((p) => p.y));
  const xs = [...new Set(points.map((p) => +new Date(p.x)))].sort((a, b) => a - b);
  const padL = 34, padB = 16, padT = 8;
  const innerW = Math.max(40, w - padL - 6);
  const innerH = height - padB - padT;
  const x = (t) => padL + (xs.length < 2 ? innerW / 2 : (innerW * (+new Date(t) - xs[0])) / (xs.at(-1) - xs[0]));
  const y = (v) => padT + innerH - (innerH * v) / max;

  return (
    <div ref={ref}>
      {!has ? (
        <Empty>даних за цей період немає</Empty>
      ) : (
        <>
          <svg className="chart" viewBox={`0 0 ${w} ${height}`} height={height}>
            {[0, 0.5, 1].map((k) => (
              <g key={k}>
                <line className="grid-line" x1={padL} x2={w - 6} y1={y(max * k)} y2={y(max * k)} />
                <text className="axis" x={0} y={y(max * k) + 3}>{format(max * k)}</text>
              </g>
            ))}
            {series.map((s) => (
              <polyline
                key={s.name}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
              />
            ))}
            {xs.length > 1 && [xs[0], xs.at(-1)].map((t, i) => (
              <text key={t} className="axis" x={i ? w - 30 : padL} y={height - 3}>{fmt.day(t)}</text>
            ))}
          </svg>
          <div className="legend">
            {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          </div>
        </>
      )}
    </div>
  );
}

// Стовпчики: для розподілів (відповіді квізів, події за днями).
export function Bars({ items, max: maxProp, format = fmt.int, color = "var(--accent)" }) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <Empty>немає відповідей</Empty>;
  return (
    <div className="stack" style={{ gap: 7 }}>
      {items.map((i) => (
        <div key={i.label} className="row" style={{ gap: 8 }}>
          <span style={{ width: 150, flex: "none", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.label}>{i.label}</span>
          <span style={{ flex: 1, height: 14, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(i.value / max) * 100}%`, background: color, borderRadius: 4 }} />
          </span>
          <b style={{ width: 46, textAlign: "right", fontSize: 11.5 }}>{format(i.value)}</b>
        </div>
      ))}
    </div>
  );
}

// Проміжок дат: типово 30 днів, як у доці.
