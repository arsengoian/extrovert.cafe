// Відповіді на опитування поштучно: анкети профілю й відгуки про напої
// в одній стрічці (docs/admin_panel.md, «Квізи»).
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Empty, Table, fmt, useData } from "../ui.jsx";

const answers = (a) =>
  Object.entries(a ?? {})
    .map(([q, v]) => `${q}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(" · ");

export function QuizResponses() {
  const { data, error, reload } = useData(() => api.quizResponses());
  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Відповіді на опитування</h1>
          <p>останні 200 · анкета профілю й відгуки про напої</p>
        </div>
        <div className="right"><button className="btn" onClick={reload}>Оновити</button></div>
      </div>

      <Table
        columns={[
          { key: "created_at", title: "коли", render: (r) => <span>{fmt.time(r.created_at)}<small>{fmt.ago(r.created_at)}</small></span> },
          { key: "kind", title: "що", render: (r) => <Badge tone={r.kind === "profile" ? "accent" : ""}>{r.kind === "profile" ? "анкета" : r.drink ?? "напій"}</Badge> },
          {
            key: "nickname", title: "хто", render: (r) => (
              <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`users/${r.user_id}`)}>{r.nickname}</button>
            ),
          },
          { key: "answers", title: "відповіді", render: (r) => <span title={answers(r.answers)}>{answers(r.answers).slice(0, 110) || <span className="muted">—</span>}</span> },
          { key: "free_text", title: "своїми словами", render: (r) => (r.free_text ? <span title={r.free_text}>{r.free_text.slice(0, 60)}</span> : <span className="muted">—</span>) },
          { key: "coins_awarded", title: "монет", num: true },
        ]}
        rows={data.responses}
        empty="відповідей ще немає"
      />
    </>
  );
}
