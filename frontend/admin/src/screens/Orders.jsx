// Замовлення за зерна: список (docs/admin_panel.md, «Замовлення»).
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

export const ORDER_STATUS = {
  new: ["bad", "нове"], printing: ["warn", "друкуємо"], packing: ["warn", "пакуємо"],
  shipped: ["accent", "відправлено"], arrived: ["accent", "у відділенні"],
  received: ["ok", "отримано"], returned: ["", "повернення"], cancelled: ["", "скасовано"],
};
export const orderBadge = (s) => { const [tone, text] = ORDER_STATUS[s] ?? ["", s]; return <Badge tone={tone}>{text}</Badge>; };

const PRODUCT = { coffee_250: "кава 250 г", merch_cup: "чашка", print_tshirt: "футболка з принтом" };

export function Orders() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData(() => api.orders({ status }), [status]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Замовлення</h1>
          <p>товари за зерна їдуть Новою Поштою · статус змінюється тут, далі його веде трекінг</p>
        </div>
        <div className="right">
          <label className="field">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">усі</option>
              {Object.entries(ORDER_STATUS).map(([k, [, title]]) => <option key={k} value={k}>{title}</option>)}
            </select>
          </label>
          <button className="btn" onClick={reload}>Оновити</button>
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="У роботі" value={fmt.int(data.counts.open)} tone={data.counts.open ? "bad" : "ok"} note="друкуємо, пакуємо, нові" />
        <Kpi label="У дорозі" value={fmt.int(data.counts.shipped)} note="передані Новій Пошті" />
        <Kpi label="Отримані" value={fmt.int(data.counts.received)} note="дійшли до користувача" />
        <Kpi label="Усього" value={fmt.int(data.counts.total)} note="за весь час" />
      </div>

      <Table
        onRow={(o) => go(`orders/${o.id}`)}
        columns={[
          { key: "id", title: "№", render: (o) => <b>{o.id}</b> },
          { key: "created_at", title: "коли", render: (o) => <span>{fmt.time(o.created_at)}<small>{fmt.ago(o.created_at)}</small></span> },
          { key: "product", title: "товар", render: (o) => <span><b>{PRODUCT[o.product] ?? o.product}</b><small>{Object.entries(o.options ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ")}</small></span> },
          { key: "nickname", title: "гравець", render: (o) => <span>{o.nickname}<small>{fmt.int(o.beans)} бобів</small></span> },
          { key: "recipient_name", title: "куди", render: (o) => <span>{o.recipient_name}<small>{(o.np_address_snapshot ?? "").slice(0, 46)}</small></span> },
          { key: "np_ttn", title: "ТТН", render: (o) => (o.np_ttn ? <b>{o.np_ttn}</b> : <span className="muted">немає</span>) },
          { key: "status", title: "стан", render: (o) => orderBadge(o.status) },
        ]}
        rows={data.orders}
        empty="замовлень ще не було"
      />
    </>
  );
}
