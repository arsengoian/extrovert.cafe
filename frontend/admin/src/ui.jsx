// Спільні дрібниці адмінки: картки, таблиці, смужка пульсу, прості графіки.
//
// Графіки намальовані руками в SVG, без бібліотеки: у нас лінія, стовпчики
// й кільце — на них amCharts важив би більше, ніж уся адмінка, а керувати
// виглядом усе одно довелося б через теми.
import { useEffect, useMemo, useRef, useState } from "react";

export const fmt = {
  uah: (n) => `${Math.round(Number(n ?? 0)).toLocaleString("uk-UA")} ₴`,
  int: (n) => Number(n ?? 0).toLocaleString("uk-UA"),
  day: (d) => new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }),
  dayFull: (d) => new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }),
  time: (d) => new Date(d).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
  ago(d) {
    if (!d) return "—";
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)} с тому`;
    if (s < 3600) return `${Math.round(s / 60)} хв тому`;
    if (s < 86400) return `${Math.round(s / 3600)} год тому`;
    return `${Math.round(s / 86400)} дн тому`;
  },
};

export const Card = ({ title, note, children, className = "", ...rest }) => (
  <section className={`card ${className}`} {...rest}>
    {(title || note) && (
      <div className="card-head">
        {title && <h2>{title}</h2>}
        {note && <span className="note">{note}</span>}
      </div>
    )}
    {children}
  </section>
);

export const Kpi = ({ label, value, note, tone }) => (
  <section className="card">
    <div className="kpi-label">{label}</div>
    <div className={`kpi-value${tone ? ` ${tone}` : ""}`}>{value}</div>
    <div className="kpi-note">{note}</div>
  </section>
);

export const Badge = ({ tone = "", children }) => <span className={`badge ${tone}`}>{children}</span>;
export const Dot = ({ ok }) => <i className={`dot ${ok === null || ok === undefined ? "" : ok ? "ok" : "bad"}`} />;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

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
export function DateRange({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const preset = (days) => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400_000);
    onChange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  };
  return (
    <div className="row">
      <label className="field"><input type="date" value={value.from ?? ""} onChange={(e) => set({ from: e.target.value })} /></label>
      <label className="field"><input type="date" value={value.to ?? ""} onChange={(e) => set({ to: e.target.value })} /></label>
      <button className="btn" onClick={() => preset(7)}>7 днів</button>
      <button className="btn" onClick={() => preset(30)}>30 днів</button>
      <button className="btn" onClick={() => preset(365)}>рік</button>
    </div>
  );
}

// Дані екрана: один хук на всі, щоб кожен не переписував стан і помилку.
export function useData(load, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const fn = useRef(load);
  fn.current = load;
  const reload = useMemo(() => async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ loading: false, data: await fn.current(), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e });
    }
  }, []);
  useEffect(() => { reload(); }, deps);
  return { ...state, reload };
}

export const Table = ({ columns, rows, onRow, empty = "порожньо" }) => (
  <div className="table-card">
    <table>
      <thead>
        <tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : ""} style={c.width ? { width: c.width } : undefined}>{c.title}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={columns.length}><div className="empty">{empty}</div></td></tr>}
        {rows.map((r, i) => (
          <tr key={r.id ?? i} data-click={onRow ? "1" : undefined} onClick={onRow ? () => onRow(r) : undefined}>
            {columns.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
