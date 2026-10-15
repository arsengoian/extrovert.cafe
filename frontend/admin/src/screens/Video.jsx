// Відео: записи й події з камер (docs/admin_panel.md, група «відео»).
// Аналітика й покупці — у VideoStats.jsx.
//
// Записи пише recorder на малині й вантажить uploader у R2 (з 06.10.2026),
// архів картки камери доливається тими самими сегментами (source 'sd'),
// події шукає worker (backend/worker) і до кожної кладе аркуш-доказ у
// приватний extrovert-evidence. І запис, і доказ браузер бере прямо з R2 за
// підписаним посиланням — через наш сервер відео не ходить.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

// idle («простій») до 12.10.2026 теж був подією; тепер порожню стійку не пишемо.
export const KIND = { approach: "підійшов", machine: "біля автомата", pass: "пройшов повз", queue: "черга" };
const HEADING = { in: "зайшов у зал", out: "вийшов із залу" };
// Що саме на аркуші — щоб не гадати, хто з рамок «та сама людина».
export const SHEET_NOTE = "Три кадри події — початок, найпевніший кадр, кінець; червона рамка — людина " +
  "події (у черзі — усі, хто стояв), жовті — інші в кадрі, блакитна лінія — межа зони біля кавʼярні. " +
  "Знизу — вирізки цієї людини з усього проходу.";
const FRAME_NOTE = "Кадр, де детектор найвпевненіший; червона рамка — людина, яку він вів (доказ до 15.10.2026).";
const mb = (n) => `${(Number(n ?? 0) / 1024 / 1024).toFixed(1)} МБ`;

const TITLES = {
  segments: ["Записи з камер", "сегменти з камер у R2, по 6 МБ на хвилину"],
  events: ["Події з камер", "підхід до кавʼярні, біля автомата, перехожий, черга"],
};
const SOURCE = { pi: "малина", sd: "картка камери" };

const small = { height: 24, padding: "0 8px" };

// Кнопка, яка спершу просить в api підписане посилання (живе 10 хвилин), а
// тоді віддає його браузеру — на завантаження або в попап.
export function UrlButton({ get, onUrl, children }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { onUrl((await get()).url); } catch (e) { onUrl(null, e); } finally { setBusy(false); }
  };
  return <button className="btn" style={small} disabled={busy} onClick={go}>{busy ? "…" : children}</button>;
}

export const download = (url, e) => (url ? window.location.assign(url) : alert(`не вдалось: ${e?.message ?? "помилка"}`));

// Попап із записом або кадром. mkv (H.264 + звук A-law) Chromium програє сам,
// разом зі звуком (перевірено 12.10.2026 на сегменті з R2); перші три
// MPEG-TS від 06.10 — ні, як і Safari. Тоді лишається «завантажити» й VLC,
// тому помилку плеєра показуємо словами, а не чорним прямокутником.
export function Viewer({ view, onClose }) {
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
        <Kpi label="В обробці" value={fmt.int(data.stats.pending)} tone={data.stats.pending > 50 ? "bad" : ""}
             note={data.stats.old ? `чекають на worker; ще ${fmt.int(data.stats.old)} — на переаналіз` : "чекають на worker"} />
        <Kpi label="Помилок" value={fmt.int(data.stats.failed)} tone={data.stats.failed ? "bad" : "ok"} note="не вдалось обробити" />
        <Kpi label="Обʼєм" value={mb(data.stats.bytes)} note="записи, що лежать у R2" />
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
            { key: "source", title: "джерело", render: (s) => SOURCE[s.source] ?? s.source },
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
            {
              key: "who", title: "хто", render: (e) => (
                <span className="muted">
                  {[e.staff ? "персонал" : null, HEADING[e.heading], e.receipt_match === "ambiguous" ? "чек — не однозначно" : null]
                    .filter(Boolean).join(" · ") || "—"}
                </span>
              ),
            },
            { key: "likely_receipt_id", title: "чек", render: (e) => e.likely_receipt_id ?? <span className="muted">—</span> },
            {
              key: "evidence", title: "доказ", render: (e) => <Evidence e={e} open={open} />,
            },
          ]}
          rows={data.events}
          empty="подій ще немає"
        />
      )}
    </>
  );
}

// Аркуш події (з 15.10.2026) або один кадр (старі події), і смужка вирізок
// людини, якщо подія — прохід людини.
export function Evidence({ e, open }) {
  const name = e.evidence?.sheet ? "sheet" : e.evidence?.frame_00 ? "frame_00" : null;
  const title = `${KIND[e.kind] ?? e.kind} · ${fmt.time(e.started_at)}`;
  if (!name && !e.crops) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {name && (
        <UrlButton get={() => api.evidence(e.id, name)} onUrl={open(title, "image", name === "sheet" ? SHEET_NOTE : FRAME_NOTE)}>
          переглянути
        </UrlButton>
      )}
      {name && <UrlButton get={() => api.evidence(e.id, name, true)} onUrl={download}>завантажити</UrlButton>}
      {e.passage_id && e.crops > 0 && (
        <UrlButton get={() => api.passageCrops(e.passage_id)} onUrl={open(`${title} · вирізки`, "image", "Вирізки людини з проходу, рівно за часом: і спиною, і обличчям.")}>
          вирізки
        </UrlButton>
      )}
    </span>
  );
}
