// «Мої замовлення»: список і картка з історією статусів.
//
// Лічильник на вкладці Магазину рахує саме непереглянуті зміни статусу
// (gamification_ui §Лічильник замовлень), тому відкрита картка їх і гасить —
// сервер ставить user_seen_at у GET цієї картки.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const STEPS = ["new", "printing", "packing", "shipped", "arrived", "received"];

export function Orders({ ctx }) {
  const [orders, setOrders] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/me/redemptions").then((r) => setOrders(r.orders));
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!orders) return <div className="stage-pad"><div className="skeleton" /></div>;

  if (open) {
    const done = STEPS.indexOf(open.status);
    return (
      <div className="stage-pad">
        <button className="btn" style={{ marginBottom: 12 }} onClick={() => { setOpen(null); load(); ctx.refreshMe(); }}>
          ← До списку
        </button>
        <div className="panel">
          <div style={{ fontWeight: 800 }}>{open.name}</div>
          {open.options?.size && <div className="muted" style={{ fontSize: 12 }}>розмір {open.options.size}</div>}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{open.address}</div>
          <div className="muted" style={{ fontSize: 12 }}>{open.recipient?.name} · {open.recipient?.phone}</div>
          {open.ttn && <div style={{ fontWeight: 700, marginTop: 6 }}>ТТН {open.ttn}</div>}
        </div>

        <ol className="steps" style={{ marginTop: 16 }}>
          {STEPS.map((status, i) => {
            const event = open.events.find((e) => e.status === status);
            return (
              <li key={status} style={{ opacity: i <= done ? 1 : 0.45 }}>
                <span className="steps-num" style={i > done ? { background: "var(--panel2)", color: "var(--muted)" } : undefined}>
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {{ new: "Прийнято", printing: "Друкуємо", packing: "Пакуємо", shipped: "У дорозі",
                       arrived: "У відділенні", received: "Отримано" }[status]}
                  </div>
                  {event && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {new Date(event.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="muted" style={{ fontSize: 12 }}>
          Зміни статусу приходять у чат кавенятка — окремих листів ми не шлемо.
        </p>
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="stage-pad">
        <div className="panel muted">
          Замовлень ще немає. Кава, чашка й футболка з принтом купуються за зерна в Магазині.
        </div>
        <button className="btn btn-primary" onClick={() => ctx.openTab("shop")}>У Магазин</button>
      </div>
    );
  }

  const show = (id) => api.get(`/me/redemptions/${id}`).then(setOpen).catch((e) => setError(e.message));

  return (
    <div className="stage-pad">
      {orders.map((o) => (
        <button key={o.id} className="panel row" style={{ gap: 12, width: "100%", textAlign: "left" }}
                onClick={() => show(o.id)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {o.name}{o.options?.size ? ` · ${o.options.size}` : ""}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{o.address}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {new Date(o.created_at).toLocaleDateString("uk-UA")} · {o.status_label}
            </div>
          </div>
          {o.unseen && <span className="nav-badge" style={{ position: "static", margin: 0 }}>!</span>}
          <span className="muted">›</span>
        </button>
      ))}
    </div>
  );
}
