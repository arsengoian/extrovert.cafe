// POS: телеметрія однієї точки (docs/admin_panel.md, «телеметрія кожної POS»).
//
// Малина збирає метрики локально й досилає їх пачками, тому графік будуємо
// за measured_at, а не за часом отримання: проґавлений інтернет має
// виглядати як пізні точки на тій самій лінії, а не як діра.
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Beat, Card, Empty, Kpi, Line, Table, fmt, useData } from "../ui.jsx";

// Метрики приходять у jsonb і можуть відрізнятися між джерелами; показуємо
// те, що прийшло, а знайомі ключі підписуємо людською мовою.
const LABELS = {
  cpu: "CPU, %", temp_c: "температура, °C", uptime_s: "аптайм", mem_used_mb: "памʼять, МБ",
  ping_ms: "ping, мс", jitter_ms: "jitter, мс", loss_pct: "втрати, %",
  down_mbit: "вниз, Мбіт", up_mbit: "вгору, Мбіт", disk_free_mb: "диск вільно, МБ",
  hdmi: "HDMI", camera: "камера", fps: "fps", release: "реліз", kiosk_fps: "fps кіоска",
};
const human = (key, value) => {
  if (key === "uptime_s") {
    const h = Number(value) / 3600;
    return h < 48 ? `${h.toFixed(1)} год` : `${(h / 24).toFixed(1)} діб`;
  }
  return typeof value === "boolean" ? (value ? "так" : "ні") : String(value);
};

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

      <div className="wrap-cols">
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
                <div className="grid k2" style={{ gap: 6 }}>
                  {Object.entries(l.metrics ?? {}).slice(0, 12).map(([k, v]) => (
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

      <Card title="Звʼязок із сервером" note="півгодинні відра, 7 днів" style={{ marginTop: 12 }}>
        <div className="beat-row">
          <span className="name">точка на звʼязку</span>
          <Beat history={health} />
        </div>
      </Card>

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
