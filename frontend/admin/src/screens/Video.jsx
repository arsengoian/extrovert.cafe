// Відео: записи, події з камер і аналітика (docs/admin_panel.md, група
// «відео»).
//
// Записи пише recorder на малині й вантажить uploader у R2 (з 06.10.2026),
// події шукає worker (backend/worker) і до кожної кладе кадр-доказ у
// приватний extrovert-evidence. І запис, і доказ браузер бере прямо з R2 за
// підписаним посиланням — через наш сервер відео не ходить.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Bars } from "../charts.jsx";
import { Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

// idle («простій») до 12.10.2026 теж був подією; тепер порожню стійку не пишемо.
const KIND = { approach: "підійшов", pass: "пройшов повз", queue: "черга" };
// Що саме на кадрі — щоб не гадати, чому на «простої» порожньо.
const EVIDENCE_NOTE = {
  approach: "Кадр, де детектор найвпевненіший; червона рамка — людина, яку він вів.",
  pass: "Кадр, де детектор найвпевненіший; червона рамка — перехожий, що до кавʼярні не підійшов.",
  queue: "Кадр, коли біля кавʼярні було найбільше людей одночасно.",
};
const mb = (n) => `${(Number(n ?? 0) / 1024 / 1024).toFixed(1)} МБ`;

const TITLES = {
  segments: ["Записи з камер", "сегменти з камер у R2, по 6 МБ на хвилину"],
  events: ["Події з камер", "підхід до кавʼярні, перехожий, черга"],
  analytics: ["Аналітика відео", "події за днями й звʼязок із чеками"],
};

const small = { height: 24, padding: "0 8px" };

// Кнопка, яка спершу просить в api підписане посилання (живе 10 хвилин), а
// тоді віддає його браузеру — на завантаження або в попап.
function UrlButton({ get, onUrl, children }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { onUrl((await get()).url); } catch (e) { onUrl(null, e); } finally { setBusy(false); }
  };
  return <button className="btn" style={small} disabled={busy} onClick={go}>{busy ? "…" : children}</button>;
}

const download = (url, e) => (url ? window.location.assign(url) : alert(`не вдалось: ${e?.message ?? "помилка"}`));

// Попап із записом або кадром. mkv (H.264 + звук A-law) Chromium програє сам,
// разом зі звуком (перевірено 12.10.2026 на сегменті з R2); перші три
// MPEG-TS від 06.10 — ні, як і Safari. Тоді лишається «завантажити» й VLC,
// тому помилку плеєра показуємо словами, а не чорним прямокутником.
function Viewer({ view, onClose }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="confirm-back" onClick={onClose}>
      <div className="confirm viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>{view.title}</b>
          <button className="btn" style={small} onClick={onClose}>закрити</button>
        </div>
        {view.error ? (
          <p>не вдалось отримати посилання: {view.error.message}</p>
        ) : broken ? (
          <p>Браузер не може програти цей файл — завантаж його й відкрий у VLC.</p>
        ) : view.type === "video" ? (
          <video src={view.url} controls autoPlay playsInline onError={() => setBroken(true)} />
        ) : (
          <img src={view.url} alt={view.title} onError={() => setBroken(true)} />
        )}
        {view.note && <p>{view.note}</p>}
      </div>
    </div>
  );
}

const STATUS = { pending: "у R2", processing: "обробляється", done: "оброблено", failed: "помилка", expired: "видалено" };

// Конверсія перехожих у підходи — питання, заради якого рахуємо pass
// (власник, 12.10.2026): з усіх, хто був у кадрі, скільки підійшли.
function Conversion({ perDay }) {
  const sum = (kind) => perDay.filter((r) => r.kind === kind).reduce((n, r) => n + r.n, 0);
  const approach = sum("approach");
  const people = approach + sum("pass");
  return (
    <div className="grid k3" style={{ marginBottom: 12 }}>
      <Kpi label="Людей у кадрі" value={fmt.int(people)} note="30 днів: підійшли + пройшли повз" />
      <Kpi label="Підійшли" value={fmt.int(approach)} note="стояли біля кавʼярні від 4 с" />
      <Kpi label="Підходять" value={people ? `${Math.round((100 * approach) / people)} %` : "—"} note="з тих, хто був у кадрі" />
    </div>
  );
}

export function Video({ tab = "segments" }) {
  const { data, error } = useData(() => api.video());
  const [view, setView] = useState(null);
  const [title, note] = TITLES[tab] ?? TITLES.segments;
  const open = (title, type, note) => (url, error) => setView({ title, type, url, error, note });

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

      {view && <Viewer key={view.url ?? "error"} view={view} onClose={() => setView(null)} />}

      {empty && (
        <Card style={{ marginBottom: 12 }}>
          <div className="empty">
            Записів ще немає: сегменти пише <b>recorder</b> на малині й вантажить у R2 <b>uploader</b> — щойно
            перший доїде, він буде тут. Події й аналітику рахує <b>worker</b> (backend/worker, docs/video.md).
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
            {
              key: "file", title: "", render: (s) => (s.status === "expired" ? null : (
                <span className="row" style={{ gap: 4 }}>
                  <UrlButton get={() => api.videoPlay(s.id)} onUrl={open(`${s.point_id} · ${s.camera_id} · ${fmt.time(s.started_at)}`, "video")}>дивитися</UrlButton>
                  <UrlButton get={() => api.videoDownload(s.id)} onUrl={download}>завантажити</UrlButton>
                </span>
              )),
            },
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
            {
              key: "evidence", title: "доказ", render: (e) => (e.evidence?.frame_00 ? (
                <span className="row" style={{ gap: 4 }}>
                  <UrlButton get={() => api.evidence(e.id, "frame_00")} onUrl={open(`${KIND[e.kind] ?? e.kind} · ${fmt.time(e.started_at)}`, "image", EVIDENCE_NOTE[e.kind])}>переглянути</UrlButton>
                  <UrlButton get={() => api.evidence(e.id, "frame_00", true)} onUrl={download}>завантажити</UrlButton>
                </span>
              ) : <span className="muted">—</span>),
            },
          ]}
          rows={data.events}
          empty="подій ще немає"
        />
      )}

      {tab === "analytics" && <Conversion perDay={data.per_day} />}

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
