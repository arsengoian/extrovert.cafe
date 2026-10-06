// Відео: записи, події з камер і аналітика (docs/admin_panel.md, група
// «відео»).
//
// Записи пише recorder на малині й вантажить uploader у R2 (з 06.10.2026).
// `worker`, який шукає події, ще не написаний (docs/video.md), тож «Події» й
// «Аналітика» чесно порожні замість вигаданих цифр.
import { useState } from "react";
import { api } from "../api.js";
import { Bars } from "../charts.jsx";
import { Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const KIND = { approach: "підійшов", queue: "черга", idle: "простій" };
const mb = (n) => `${(Number(n ?? 0) / 1024 / 1024).toFixed(1)} МБ`;

const TITLES = {
  segments: ["Записи з камер", "сегменти з камер у R2, по 6 МБ на хвилину"],
  events: ["Події з камер", "підхід до автомата, черга, простій"],
  analytics: ["Аналітика відео", "події за днями й звʼязок із чеками"],
};

// MPEG-TS браузер сам не програє, тож це завантаження: файл відкривається
// у VLC чи іншому плеєрі. Посилання підписане й живе 10 хвилин.
function Download({ id }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { window.location.assign((await api.videoDownload(id)).url); } finally { setBusy(false); }
  };
  return <button className="btn" style={{ height: 24, padding: "0 8px" }} disabled={busy} onClick={go}>{busy ? "…" : "завантажити"}</button>;
}

const STATUS = { pending: "у R2", processing: "обробляється", done: "оброблено", failed: "помилка", expired: "видалено" };

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
            Записів ще немає: сегменти пише <b>recorder</b> на малині й вантажить у R2 <b>uploader</b> — щойно
            перший доїде, він буде тут. Події й аналітику рахуватиме <b>worker</b> на окремому дроплеті (docs/video.md).
          </div>
        </Card>
      )}

      {tab === "segments" && (
        <Table
          columns={[
            { key: "started_at", title: "початок", render: (s) => fmt.time(s.started_at) },
            { key: "point_id", title: "точка" },
            { key: "camera_id", title: "камера" },
            { key: "bytes", title: "розмір", num: true, render: (s) => mb(s.bytes) },
            { key: "status", title: "стан", render: (s) => STATUS[s.status] ?? s.status },
            { key: "error", title: "помилка", render: (s) => s.error ?? "" },
            { key: "file", title: "", render: (s) => (s.status === "expired" ? null : <Download id={s.id} />) },
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
