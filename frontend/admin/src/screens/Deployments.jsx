// Історія деплойментів цін: що, коли й куди поїхало (docs/admin_panel.md).
import { api } from "../api.js";
import { Badge, Empty, Table, fmt, useData } from "../ui.jsx";

const STATUS = {
  queued: ["", "у черзі"], deploying: ["warn", "котиться"], done: ["ok", "готово"],
  partial: ["warn", "частково"], failed: ["bad", "впало"],
};
const badge = (s) => { const [tone, text] = STATUS[s] ?? ["", s]; return <Badge tone={tone}>{text}</Badge>; };

export function Deployments() {
  const { data, error, reload } = useData(() => api.deployments());
  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Історія деплойментів</h1>
          <p>останні 50 · ціни їдуть у публічний бакет, звідки їх бере точка</p>
        </div>
        <div className="right"><button className="btn" onClick={reload}>Оновити</button></div>
      </div>

      <Table
        columns={[
          { key: "id", title: "№", render: (d) => <b>{d.id}</b> },
          { key: "status", title: "стан", render: (d) => badge(d.status) },
          { key: "created_at", title: "створений", render: (d) => <span>{fmt.time(d.created_at)}<small>{d.created_by ?? "система"}</small></span> },
          { key: "finished_at", title: "завершений", render: (d) => (d.finished_at ? fmt.time(d.finished_at) : <span className="muted">—</span>) },
          {
            key: "targets", title: "цілі", render: (d) => (
              <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(d.targets ?? []).map((t) => (
                  <span key={`${t.point_id}-${t.kind}`} title={t.error ?? ""}>
                    <Badge tone={STATUS[t.status]?.[0] ?? ""}>{t.name} · {t.kind}</Badge>
                  </span>
                ))}
                {!d.targets?.length && <span className="muted">—</span>}
              </span>
            ),
          },
        ]}
        rows={data.deployments}
        empty="деплойментів ще не було"
      />
    </>
  );
}
