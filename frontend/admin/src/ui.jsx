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
