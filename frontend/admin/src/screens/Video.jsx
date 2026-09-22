// Відео: записи, події з камер і аналітика (docs/admin_panel.md, група
// «відео»).
//
// Камер на точці ще немає, а `worker`, який ріже сегменти й шукає події, не
// написаний (docs/video.md — це план). Тому екрани чесно показують порожньо
// замість вигаданих цифр: таблиці вже є, і щойно зʼявиться перший сегмент,
// ці самі запити почнуть його показувати.
import { api } from "../api.js";
import { Bars, Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const KIND = { approach: "підійшов", queue: "черга", idle: "простій" };
const mb = (n) => `${(Number(n ?? 0) / 1024 / 1024).toFixed(1)} МБ`;

const TITLES = {
  segments: ["Відео · записи", "сегменти з камер у R2, по 6 МБ на хвилину"],
  events: ["Події з камер", "підхід до автомата, черга, простій"],
  analytics: ["Аналітика відео", "події за днями й звʼязок із чеками"],
};

export function Video({ tab = "segments" }) {
  const { data, error } = useData(() => api.video());
  const [title, note] = TITLES[tab] ?? TITLES.segments;

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const empty = data.stats.events === 0 && data.segments.length === 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>{title}</h1>
          <p>{note}</p>
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Сегментів" value={fmt.int(data.segments.length)} note="останні 100" />
        <Kpi label="В обробці" value={fmt.int(data.stats.pending)} tone={data.stats.pending > 50 ? "bad" : ""} note="чекають на worker" />
        <Kpi label="Помилок" value={fmt.int(data.stats.failed)} tone={data.stats.failed ? "bad" : "ok"} note="не вдалось обробити" />
        <Kpi label="Обʼєм" value={mb(data.stats.bytes)} note="усе, що лежить у R2" />
      </div>

      {empty && (
        <Card style={{ marginBottom: 12 }}>
          <div className="empty">
            Камер на точці ще немає: сегменти пише <b>recorder</b> на малині, а ріже їх <b>worker</b> на
            окремому дроплеті — обидва ще не запущені (docs/video.md). Щойно зʼявиться перший запис, він буде тут.
          </div>
        </Card>
      )}

      {tab === "segments" && (
        <Table
          columns={[
            { key: "started_at", title: "початок", render: (s) => fmt.time(s.started_at) },
            { key: "point_id", title: "точка" },
            { key: "camera_id", title: "камера" },
            { key: "duration_ms", title: "тривалість", num: true, render: (s) => `${Math.round((s.duration_ms ?? 0) / 1000)} с` },
            { key: "bytes", title: "розмір", num: true, render: (s) => mb(s.bytes) },
            { key: "status", title: "стан", render: (s) => s.status },
            { key: "error", title: "помилка", render: (s) => s.error ?? "" },
          ]}
          rows={data.segments}
          empty="записів ще немає"
        />
      )}

      {tab === "events" && (
        <Table
          columns={[
            { key: "started_at", title: "коли", render: (e) => fmt.time(e.started_at) },
            { key: "point_id", title: "точка" },
            { key: "kind", title: "подія", render: (e) => KIND[e.kind] ?? e.kind },
            { key: "len", title: "тривалість", num: true, render: (e) => (e.ended_at ? `${Math.round((new Date(e.ended_at) - new Date(e.started_at)) / 1000)} с` : "—") },
            { key: "likely_receipt_id", title: "ймовірний чек", render: (e) => e.likely_receipt_id ?? <span className="muted">—</span> },
          ]}
          rows={data.events}
          empty="подій ще немає"
        />
      )}

      {tab === "analytics" && (
        <div className="wrap-cols">
          <Card title="Події за днями" note="30 днів">
            <Bars
              items={Object.entries(
                data.per_day.reduce((acc, r) => ({ ...acc, [fmt.day(r.day)]: (acc[fmt.day(r.day)] ?? 0) + r.n }), {})
              ).map(([label, value]) => ({ label, value }))}
            />
          </Card>
          <Card title="За типом" note="усі події">
            <Bars
              items={Object.entries(
                data.per_day.reduce((acc, r) => ({ ...acc, [KIND[r.kind] ?? r.kind]: (acc[KIND[r.kind] ?? r.kind] ?? 0) + r.n }), {})
              ).map(([label, value]) => ({ label, value }))}
              color="#4FA8FF"
            />
          </Card>
        </div>
      )}
    </>
  );
}
