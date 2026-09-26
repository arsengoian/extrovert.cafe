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
  // «181 відповідей» — не українська. Три форми, як усюди в панелі:
  // 1 відповідь, 2 відповіді, 5 відповідей (і 11 — теж «відповідей»).
  plural: (n, one, few, many) => {
    const t = Math.abs(Math.round(n)) % 100, d = t % 10;
    if (t > 10 && t < 20) return many;
    return d === 1 ? one : d >= 2 && d <= 4 ? few : many;
  },
  ago(d) {
    if (!d) return "—";
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)} с тому`;
    if (s < 3600) return `${Math.round(s / 60)} хв тому`;
    if (s < 86400) return `${Math.round(s / 3600)} год тому`;
    return `${Math.round(s / 86400)} дн тому`;
  },
};

// Метрики телеметрії приходять у jsonb і відрізняються між джерелами:
// малина шле одне, автомат шле щось своє, чого ми ще не бачили. Показуємо
// те, що прийшло, а знайомі ключі підписуємо людською мовою. Словник тут,
// а не на екрані точки, бо читають його двоє: сторінка POS і рядок на
// дашборді здоровʼя — і підпис для нового ключа має зʼявитись одразу в обох.
export const METRIC_LABELS = {
  cpu: "CPU, %", temp_c: "температура, °C", uptime_s: "аптайм", mem_used_mb: "памʼять, МБ",
  ping_ms: "ping, мс", jitter_ms: "jitter, мс", loss_pct: "втрати, %", mem_total_mb: "памʼять всього, МБ",
  down_mbit: "вниз, Мбіт", up_mbit: "вгору, Мбіт", disk_free_mb: "диск вільно, МБ",
  hdmi: "HDMI", camera: "камера", fps: "fps", release: "реліз", kiosk_fps: "fps кіоска",
  monitor_on: "монітор", video_ok: "відеопотік",
  monitor_src: "чим перевірено монітор", monitor_woke: "будили монітор",
  throttled: "живлення (біти)", root_ro: "картка read-only", usb_ok: "флешка",
  kiosk_frames: "кадрів усього",
};

export const metricValue = (key, value) => {
  if (key === "uptime_s") {
    const h = Number(value) / 3600;
    return h < 48 ? `${h.toFixed(1)} год` : `${(h / 24).toFixed(1)} діб`;
  }
  return typeof value === "boolean" ? (value ? "так" : "ні") : String(value);
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

// foot — рядок під таблицею, у тій самій картці: там живуть підказки про
// незбережений стан, які мусять бути притулені до рядків, а не висіти
// окремим блоком десь поруч.
export const Table = ({ columns, rows, onRow, empty = "порожньо", foot = null }) => (
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
    {foot && <div className="table-foot">{foot}</div>}
  </div>
);
