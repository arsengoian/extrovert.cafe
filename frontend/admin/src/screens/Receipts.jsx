// Покупки з Checkbox: повна історія чеків із бонусом і тим, хто його забрав
// (docs/admin_panel.md, «Покупки»).
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, DateRange, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const BONUS = {
  pending: ["warn", "чекає"], claimed: ["accent", "показаний"], redeemed: ["ok", "зарахований"],
  expired: ["", "згорів"], cancelled: ["", "скасований"],
};

export function Receipts() {
  const [range, setRange] = useState({});
  const { data, error } = useData(() => api.receipts(range), [range.from, range.to]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Покупки з Checkbox</h1>
          <p>{fmt.dayFull(data.from)} — {fmt.dayFull(data.to)} · чек, позиції, бонус і хто його забрав</p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Чеків" value={fmt.int(data.totals.receipts)} note="за період" />
        <Kpi label="Виручка" value={fmt.uah(data.totals.sum_uah)} note="сума чеків" />
        <Kpi
          label="Бонусів забрали"
          value={fmt.int(data.totals.redeemed)}
          note={data.totals.receipts ? `${Math.round((data.totals.redeemed / data.totals.receipts) * 100)}% чеків` : "—"}
        />
      </div>

      <Table
        columns={[
          { key: "fiscal_date", title: "коли", render: (r) => <span>{fmt.time(r.fiscal_date)}<small>{r.point_name ?? r.point_id}</small></span> },
          {
            key: "items", title: "позиції", render: (r) => (
              <span>
                {(r.items ?? []).map((i) => `${i.name}${i.bonus ? " (бонусний)" : ""} ×${Number(i.qty)}`).join(", ") || <span className="muted">—</span>}
              </span>
            ),
          },
          { key: "total_sum", title: "сума", num: true, render: (r) => fmt.uah(r.total_sum) },
          { key: "source", title: "звідки", render: (r) => <Badge>{r.source}</Badge> },
          {
            key: "bonus", title: "бонус", render: (r) => {
              if (!r.bonus_status) return <span className="muted">без бонусу</span>;
              const [tone, text] = BONUS[r.bonus_status] ?? ["", r.bonus_status];
              return <span className="row" style={{ gap: 6 }}><Badge tone={tone}>{text}</Badge><span className="muted">{fmt.int(r.bonus_coins)} монет</span></span>;
            },
          },
          {
            key: "redeemed_nickname", title: "хто забрав", render: (r) => (r.redeemed_by
              ? <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`users/${r.redeemed_by}`)}>{r.redeemed_nickname}</button>
              : <span className="muted">—</span>),
          },
          {
            key: "tax_url", title: "", render: (r) => (r.tax_url
              ? <a href={r.tax_url} target="_blank" rel="noreferrer" className="muted">чек ДПС ↗</a>
              : null),
          },
        ]}
        rows={data.receipts}
        empty="чеків за цей період немає"
      />
    </>
  );
}
