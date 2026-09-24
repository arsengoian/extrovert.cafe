// POS: телеметрія однієї точки (docs/admin_panel.md, «телеметрія кожної POS»).
//
// Малина збирає метрики локально й досилає їх пачками, тому графік будуємо
// за measured_at, а не за часом отримання: проґавлений інтернет має
// виглядати як пізні точки на тій самій лінії, а не як діра.
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Beat, BeatScale, Line } from "../charts.jsx";
import { Card, Empty, Kpi, METRIC_LABELS as LABELS, Table, fmt, metricValue as human, useData } from "../ui.jsx";

// Булеві показники, для яких малюємо тижневу смужку. `pick` повертає
// true/false або null — «проби не було й судити нема з чого».
const SIGNALS = [
  { key: "monitor", name: "монітор", note: "CEC: увімкнений",
    pick: (m) => (m.monitor_on === undefined ? null : m.monitor_on) },
  { key: "kiosk", name: "кіоск малює", note: "fps > 0",
    pick: (m) => (m.kiosk_fps === undefined || m.kiosk_fps === null ? null : Number(m.kiosk_fps) > 0) },
  { key: "power", name: "живлення", note: "без просідань",
    pick: (m) => (m.throttled === undefined || m.throttled === null ? null : (Number(m.throttled) & 0x5) === 0) },
  { key: "card", name: "картка пишеться", note: "не read-only",
    pick: (m) => (m.root_ro === undefined || m.root_ro === null ? null : m.root_ro === false) },
  { key: "usb", name: "флешка", note: "змонтована й пишеться",
    pick: (m) => (m.usb_ok === undefined ? null : m.usb_ok) },
  { key: "net", name: "інтернет", note: "втрати менші за 5 %",
    pick: (m) => (m.loss_pct === undefined || m.loss_pct === null ? null : Number(m.loss_pct) < 5) },
  { key: "video", name: "відеопотік", note: "камера відповідає",
    pick: (m) => (m.video_ok === undefined ? null : m.video_ok) },
  { key: "temp", name: "температура", note: "нижче 80 °C",
    pick: (m) => (m.temp_c === undefined || m.temp_c === null ? null : Number(m.temp_c) < 80) },
  { key: "memory", name: "памʼять", note: "є запас",
    pick: (m) => (m.mem_total_mb ? Number(m.mem_used_mb) / Number(m.mem_total_mb) <= 0.92 : null) },
];

// Що малюємо лініями під мережею: три показники, по яких видно, що точці
// стає зле ще до того, як щось упаде (прохання власника 24.09.2026).
const HARDWARE = [
  { key: "mem_used_mb", name: "памʼять, МБ", color: "#5AA9FF" },
  { key: "kiosk_fps", name: "fps кіоска", color: "#B07CFF" },
  { key: "temp_c", name: "температура, °C", color: "#FFB020", format: (v) => v.toFixed(0) },
  { key: "disk_free_mb", name: "диск вільно, МБ", color: "#3FBF6F" },
];

const BUCKET_MS = 30 * 60_000;

// Проби телеметрії → та сама структура, яку малює Beat (charts.jsx): рядок
// «1/0/?» по відру на півгодини. Рахуємо на клієнті, бо історія проб уже
// приїхала разом зі сторінкою — окремий запит на сервер тут був би за тими
// самими даними.
function boolSeries(history, pick) {
  const buckets = new Map();
  for (const h of history) {
    const v = pick(h.metrics ?? {});
    if (v === null || v === undefined) continue;
    const t = Math.floor(new Date(h.measured_at).getTime() / BUCKET_MS) * BUCKET_MS;
    buckets.set(t, (buckets.get(t) ?? true) && Boolean(v));
  }
  const last = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const from = last - 7 * 24 * 3600_000;
  let line = "";
  for (let t = from; t <= last; t += BUCKET_MS) {
    line += buckets.has(t) ? (buckets.get(t) ? "1" : "0") : "?";
  }
  return { from, step: BUCKET_MS, line, fails: [], seen: buckets.size > 0 };
}

// Порядок карток метрик: спершу те, про що питають найчастіше, далі решта
// за абеткою. Ключ, якого тут немає, не зникає — просто йде в кінець.
const ORDER = [
  "monitor_on", "monitor_src", "monitor_woke", "video_ok", "kiosk_fps", "release",
  "ping_ms", "jitter_ms", "loss_pct", "throttled", "temp_c", "cpu",
  "mem_used_mb", "mem_total_mb", "disk_free_mb", "root_ro", "usb_ok", "uptime_s", "kiosk_frames",
];

export function Pos({ id }) {
  const { data, error, loading } = useData(() => api.point(id), [id]);

  if (loading && !data) return <Empty>вантажимо…</Empty>;
  if (error) return <Empty>{error.status === 404 ? "немає такої точки" : `не вдалось прочитати: ${error.message}`}</Empty>;

  const { point, latest, history, health, uptime_7d: uptime, receipts } = data;
  const pi = latest.find((l) => l.source === "pi");
  const series = (key) => history
    .filter((h) => h.metrics && h.metrics[key] !== undefined && h.metrics[key] !== null)
    .map((h) => ({ x: h.measured_at, y: Number(h.metrics[key]) }));

  const ping = series("ping_ms");
  const jitter = series("jitter_ms");

  return (
    <>
      <div className="head">
        <div>
          <h1>{point.name}</h1>
          <p>
            {point.id} · {point.short_address ?? point.address ?? "адреси немає"} ·{" "}
            {point.last_seen_at ? `озивалась ${fmt.ago(point.last_seen_at)}` : "не озивалась жодного разу"}
          </p>
        </div>
        <div className="right">
          <button className="btn" onClick={() => go("health")}>← до здоровʼя</button>
          <span className="env"><i style={{ background: point.last_seen_at ? "var(--ok)" : "var(--bad)" }} />{point.status}</span>
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi
          label="Аптайм 7 днів"
          value={uptime === null ? "—" : `${(uptime * 100).toFixed(1)}%`}
          tone={uptime === null ? "" : uptime > 0.99 ? "ok" : "bad"}
          note={uptime === null ? "проб ще не було" : "за пробами overseer"}
        />
        <Kpi label="Ключ точки" value={point.has_key ? "є" : "немає"} tone={point.has_key ? "ok" : "bad"}
             note={point.key_revoked_at ? "відкликаний" : point.has_key ? "кіоск може брати токен" : "кіоск працює без токена"} />
        <Kpi label="Чеків за добу" value={fmt.int(receipts.day)} note={receipts.last ? `останній ${fmt.ago(receipts.last)}` : "чеків не було"} />
        <Kpi label="Телеметрія" value={pi ? fmt.ago(pi.measured_at) : "—"} tone={pi ? "" : "bad"}
             note={pi ? "остання проба з малини" : "малина ще нічого не слала"} />
      </div>

      {/* Історія всіх булевих показників — тут, а не на дашборді здоровʼя:
          там потрібна одна відповідь «усе гаразд / ні», а «коли саме
          гасився екран минулої середи» дивляться вже прицільно, на точці
          (прохання власника 24.09.2026).
          Відра півгодинні, як у overseer: у відрі досить однієї поганої
          проби, щоб воно стало червоним, — поломку так не проґавиш. */}
      <Card title="Історія показників" note="півгодинні відра, 7 днів">
        <div className="beat-row">
          <span className="name">точка на звʼязку</span>
          <Beat history={health} />
          <span className="ms" />
          <span className="value">проби overseer</span>
        </div>
        {SIGNALS.map((s) => {
          const series = boolSeries(history, s.pick);
          return (
            <div className="beat-row" key={s.key}>
              <span className="name">{s.name}</span>
              <Beat history={series} />
              <span className="ms" />
              <span className="value">{series.seen ? s.note : "проб немає"}</span>
            </div>
          );
        })}
        <BeatScale history={health} />
      </Card>

      <div className="wrap-cols" style={{ marginTop: 12 }}>
        <div className="stack">
        <Card title="Ping і jitter" note="7 днів, за часом виміру">
          {ping.length || jitter.length ? (
            <Line series={[
              ...(ping.length ? [{ name: "ping, мс", color: "#FE810B", points: ping }] : []),
              ...(jitter.length ? [{ name: "jitter, мс", color: "#3FBF6F", points: jitter }] : []),
            ]} />
          ) : (
            <Empty>малина ще не слала мережевих метрик</Empty>
          )}
        </Card>

        {/* Кожен показник — своя вісь і своя лінія на всю ширину колонки:
            памʼять міряється сотнями МБ, диск — тисячами, fps — десятками,
            температура — півсотнею градусів. На спільній шкалі диск
            притиснув би решту до нуля, і перегрів на 82 °C виглядав би так
            само, як 48 °C. */}
        <Card title="Залізо точки" note="7 днів, за часом виміру">
          <div className="stack" style={{ gap: 10 }}>
            {HARDWARE.map((h) => {
              const points = series(h.key);
              return (
                <div key={h.key}>
                  <div className="muted" style={{ fontSize: 10.5, marginBottom: 2 }}>{h.name}</div>
                  {points.length
                    ? <Line series={[{ name: h.name, color: h.color, points }]} height={110} format={h.format} legend={false} />
                    : <Empty>проб немає</Empty>}
                </div>
              );
            })}
          </div>
        </Card>
        </div>

        <Card title="Компоненти точки" note="остання проба">
          {latest.length === 0 ? (
            <Empty>телеметрії ще не було</Empty>
          ) : (
            latest.map((l) => (
              <div key={l.source} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <b style={{ fontSize: 12 }}>{l.source === "pi" ? "Raspberry Pi" : l.source === "jetinno" ? "Автомат Jetinno" : "Камера"}</b>
                  <span className="muted" style={{ fontSize: 10.5 }}>{fmt.ago(l.measured_at)}</span>
                </div>
                {/* Усі метрики, а не перші дванадцять. Обрізання підвело
                    24.09.2026: проба виросла до вісімнадцяти полів, і саме
                    monitor_on з monitor_woke — те, заради чого сюди й
                    заходять, — не влізло, бо порядок ключів у jsonb свій.
                    Знайомі підписи йдуть першими, решта — як прийшли. */}
                <div className="grid k2" style={{ gap: 6 }}>
                  {Object.entries(l.metrics ?? {})
                    .sort(([a], [b]) => {
                      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
                      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
                    })
                    .map(([k, v]) => (
                    <div key={k} className="row" style={{ justifyContent: "space-between", fontSize: 11.5 }}>
                      <span className="muted">{LABELS[k] ?? k}</span>
                      <b>{human(k, v)}</b>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Table
          columns={[
            { key: "measured_at", title: "коли", render: (r) => fmt.time(r.measured_at) },
            { key: "source", title: "джерело" },
            { key: "metrics", title: "метрики", render: (r) => <span className="muted">{Object.entries(r.metrics ?? {}).map(([k, v]) => `${LABELS[k] ?? k}: ${human(k, v)}`).join(" · ")}</span> },
          ]}
          rows={history.slice(-50).reverse()}
          empty="телеметрії за тиждень немає"
        />
      </div>
    </>
  );
}
