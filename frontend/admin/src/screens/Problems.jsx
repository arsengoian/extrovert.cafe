// Проблеми: те, що гравці шлють формою «щось не працює»
// (docs/admin_panel.md). Статуси: нове → прочитане → закрите.
import { useState } from "react";
import { api } from "../api.js";
import { Badge, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";
import { go } from "../app.jsx";

// Ті самі ключі, що шле застосунок (backend/api/src/routes/problems.js).
const CATEGORY = {
  coffee_machine: "кавомашина", monitor: "монітор", site: "сайт",
  supplies: "витратники", idea: "ідея",
};

const BTN = { height: 24, padding: "0 8px" };

// Посилання підписане й живе пʼять хвилин, тому беремо його на клік, а не
// разом зі списком: інакше половина посилань у таблиці протухла б раніше,
// ніж до них дійшли руки.
async function photo(id, download) {
  const { url } = await api.problemPhoto(id, download);
  window.open(url, "_blank", "noopener");
}

export function Problems() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData(() => api.problems({ status }), [status]);
  const [busy, setBusy] = useState(null);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const setState = async (id, next) => {
    setBusy(id);
    try {
      await api.problemStatus(id, next);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Проблеми · «щось не працює»</h1>
          <p>скарги з застосунку · фото зберігаються в R2 й відкриваються за підписаним посиланням</p>
        </div>
        <div className="right">
          <label className="field">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">усі</option>
              <option value="new">нові</option>
              <option value="read">прочитані</option>
              <option value="closed">закриті</option>
            </select>
          </label>
          <button className="btn" onClick={reload}>Оновити</button>
        </div>
      </div>

      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Нових" value={fmt.int(data.counts.new)} tone={data.counts.new ? "bad" : "ok"} note="ще ніхто не дивився" />
        <Kpi label="Прочитаних" value={fmt.int(data.counts.read)} note="у роботі" />
        <Kpi label="Закритих" value={fmt.int(data.counts.closed)} note="разом за весь час" />
      </div>

      <Table
        columns={[
          { key: "created_at", title: "коли", render: (p) => <span>{fmt.time(p.created_at)}<small>{fmt.ago(p.created_at)}</small></span> },
          {
            key: "who", title: "хто", render: (p) => (p.nickname
              ? <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`users/${p.user_id}`)}>{p.nickname}</button>
              : <span className="muted">гість</span>),
          },
          { key: "point_name", title: "точка", render: (p) => p.point_name ?? <span className="muted">—</span> },
          {
            key: "categories", title: "про що", render: (p) => (
              <span className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                {(p.categories ?? []).map((c) => <Badge key={c}>{CATEGORY[c] ?? c}</Badge>)}
              </span>
            ),
          },
          {
            key: "body", title: "деталі", render: (p) => (
              <span className="row" style={{ gap: 6 }}>
                <span title={p.body ?? ""}>{(p.body ?? "").slice(0, 90) || <span className="muted">без тексту</span>}</span>
                {p.image_r2_key && (
                  <>
                    <button className="btn" style={BTN} title="відкрити фото" onClick={(e) => { e.stopPropagation(); photo(p.id, false); }}>📎</button>
                    <button className="btn" style={BTN} title="зберегти фото" onClick={(e) => { e.stopPropagation(); photo(p.id, true); }}>⤓</button>
                  </>
                )}
              </span>
            ),
          },
          {
            key: "status", title: "стан", render: (p) => (
              <span className="row" style={{ gap: 6 }}>
                <Badge tone={p.status === "new" ? "bad" : p.status === "closed" ? "" : "warn"}>
                  {p.status === "new" ? "нове" : p.status === "read" ? "в роботі" : "закрите"}
                </Badge>
                {p.status !== "closed" && (
                  <button
                    className="btn"
                    style={{ height: 24, padding: "0 8px" }}
                    disabled={busy === p.id}
                    onClick={(e) => { e.stopPropagation(); setState(p.id, p.status === "new" ? "read" : "closed"); }}
                  >
                    {p.status === "new" ? "взяти" : "закрити"}
                  </button>
                )}
              </span>
            ),
          },
        ]}
        rows={data.problems}
        empty="скарг немає — і це добра новина"
      />
    </>
  );
}
