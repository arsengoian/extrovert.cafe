// Користувачі: пошук за нікнеймом чи поштою, баланси, остання поява
// (docs/admin_panel.md, «Користувачі»).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Empty, Kpi, Pager, Table, fmt, useData, usePage } from "../ui.jsx";

export function Users() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  // Шукаємо, поки людина друкує, — з паузою 300 мс, щоб не слати запит на
  // кожну літеру (16.10.2026; досі треба було тиснути «Знайти»).
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const [page, setPage] = usePage(query);
  const { data, error, loading } = useData(() => api.users({ q: query, page }), [query, page]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Користувачі</h1>
          <p>{fmt.int(data.counts.total)} акаунтів у статистиці – список за останньою появою, разом зі своїми й тестовими</p>
        </div>
        <div className="right">
          <form className="field" style={{ width: 240 }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <input type="search" placeholder="нікнейм або пошта" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
      </div>

      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Усього" value={fmt.int(data.counts.total)} note="живих, без тих, що поза статистикою" />
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
          { key: "state", title: "", render: (u) => (u.deleted_at ? <Badge>видалений</Badge> : u.stats_excluded ? <Badge>поза статистикою</Badge> : null) },
        ]}
        rows={data.users}
        empty="нікого не знайшли"
        foot={<Pager info={data.page} onPage={setPage} busy={loading} />}
      />
    </>
  );
}
