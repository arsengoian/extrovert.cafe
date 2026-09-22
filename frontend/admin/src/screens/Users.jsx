// Користувачі: пошук за нікнеймом чи поштою, баланси, остання поява
// (docs/admin_panel.md, «Користувачі»).
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

export function Users() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error } = useData(() => api.users({ q: query }), [query]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Користувачі</h1>
          <p>{fmt.int(data.counts.total)} акаунтів · показуємо перші 200 за останньою появою</p>
        </div>
        <div className="right">
          <form className="field" style={{ width: 240 }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <input placeholder="нікнейм або пошта" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <button className="btn" onClick={() => setQuery(q.trim())}>Знайти</button>
        </div>
      </div>

      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Усього" value={fmt.int(data.counts.total)} note="живих акаунтів" />
        <Kpi label="За тиждень" value={fmt.int(data.counts.week)} note="заходили" />
        <Kpi label="Нових за тиждень" value={fmt.int(data.counts.fresh)} note="зареєструвались" />
      </div>

      <Table
        onRow={(u) => go(`users/${u.id}`)}
        columns={[
          { key: "nickname", title: "гравець", render: (u) => <span><b>{u.nickname}</b><small>{u.email ?? "без пошти"}</small></span> },
          { key: "coins_yellow", title: "жовті", num: true, render: (u) => fmt.int(u.coins_yellow) },
          { key: "coins_silver", title: "срібні", num: true, render: (u) => fmt.int(u.coins_silver) },
          { key: "beans", title: "боби", num: true, render: (u) => fmt.int(u.beans) },
          { key: "plants", title: "кавенят", num: true, render: (u) => <span>{u.plants}{u.top_stage !== null && <small>стадія {u.top_stage}</small>}</span> },
          { key: "items", title: "речей", num: true },
          { key: "last_seen_at", title: "остання поява", render: (u) => (u.last_seen_at ? fmt.ago(u.last_seen_at) : <span className="muted">не заходив</span>) },
          { key: "state", title: "", render: (u) => (u.deleted_at ? <Badge>видалений</Badge> : null) },
        ]}
        rows={data.users}
        empty="нікого не знайшли"
      />
    </>
  );
}
