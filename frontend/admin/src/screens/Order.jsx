// Картка замовлення: деталі доставки, історія статусів, зміна статусу й ТТН.
//
// Накладну ми поки створюємо в кабінеті НП руками й вписуємо номер сюди:
// створення ТТН прямо з адмінки (`InternetDocument/save`) ще не написане
// (docs/services.md, «Доставка Новою Поштою»).
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Card, Empty, fmt, useData } from "../ui.jsx";
import { ORDER_STATUS, orderBadge } from "./Orders.jsx";

const Row = ({ label, children }) => (
  <div className="row" style={{ justifyContent: "space-between", padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(242,239,230,.05)" }}>
    <span className="muted">{label}</span>
    <span style={{ textAlign: "right" }}>{children}</span>
  </div>
);

export function Order({ id }) {
  const { data, error, reload } = useData(() => api.order(id), [id]);
  const [status, setStatus] = useState("");
  const [ttn, setTtn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) return <Empty>{error.status === 404 ? "немає такого замовлення" : error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;
  const { order, events } = data;

  const save = async () => {
    setBusy(true);
    try {
      await api.orderStatus(order.id, { status: status || order.status, ttn: ttn.trim() || undefined, note: note.trim() || undefined });
      setStatus(""); setTtn(""); setNote("");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Замовлення №{order.id}</h1>
          <p>{fmt.time(order.created_at)} · {order.product} · {order.nickname}</p>
        </div>
        <div className="right">
          {orderBadge(order.status)}
          <button className="btn" onClick={() => go("orders")}>← до списку</button>
        </div>
      </div>

      <div className="wrap-cols">
        <div className="stack">
          <Card title="Доставка">
            <Row label="Отримувач">{order.recipient_name}</Row>
            <Row label="Телефон">{order.recipient_phone}</Row>
            <Row label="Відділення">{order.np_address_snapshot}</Row>
            <Row label="Тип">{order.np_warehouse_kind ?? "—"}</Row>
            <Row label="ТТН">{order.np_ttn ?? <span className="muted">ще немає</span>}</Row>
            <Row label="Статус НП">{order.np_status_code ?? <span className="muted">—</span>}</Row>
          </Card>

          <Card title="Замовлення">
            <Row label="Товар">{order.product}</Row>
            <Row label="Опції">{Object.entries(order.options ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</Row>
            <Row label="Собівартість">{order.cost_uah_actual ? fmt.uah(order.cost_uah_actual) : <span className="muted">не вказана</span>}</Row>
            <Row label="Гравець">
              <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`users/${order.user_id}`)}>{order.nickname}</button>
            </Row>
          </Card>
        </div>

        <div className="stack">
          <Card title="Змінити стан" note="кожна зміна лягає в історію">
            <div className="stack" style={{ gap: 9 }}>
              <label className="field">
                <select value={status || order.status} onChange={(e) => setStatus(e.target.value)}>
                  {Object.entries(ORDER_STATUS).map(([k, [, title]]) => <option key={k} value={k}>{title}</option>)}
                </select>
              </label>
              <label className="field"><input placeholder="номер ТТН" value={ttn} onChange={(e) => setTtn(e.target.value)} /></label>
              <label className="field"><input placeholder="нотатка (побачить лише адмін)" value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Зберігаємо…" : "Зберегти"}</button>
            </div>
          </Card>

          <Card title="Історія" note={`${events.length} подій`}>
            {events.length === 0 ? (
              <Empty>історія порожня</Empty>
            ) : (
              events.map((e) => (
                <div key={e.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", fontSize: 11.5 }}>
                  <span>{orderBadge(e.status)} <span className="muted">{e.source}</span></span>
                  <span className="muted" title={e.note ?? ""}>{fmt.time(e.created_at)}</span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
