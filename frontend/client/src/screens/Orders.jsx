// «Мої замовлення» — кадри «Мої замовлення · список» і «· картка»: вкладки
// «Активні / Завершені», картка на замовлення зі статусом і ціною, а сама
// картка замовлення — окремий екран із таймлайном статусів.
//
// Лічильник на вкладці Магазину рахує саме непереглянуті зміни статусу
// (gamification_ui §Лічильник замовлень), тому відкрита картка їх і гасить —
// сервер ставить user_seen_at у GET цієї картки.
import { useEffect, useState } from "react";
import { api } from "../api.js";

// Завершені — скасовані, повернуті й отримані понад два тижні тому:
// щойно отримане ще лишається серед активних, як у макеті.
const FORTNIGHT = 14 * 864e5;
const isDone = (o) => o.status === "cancelled" || o.status === "returned"
  || (o.status === "received" && Date.now() - new Date(o.status_changed_at) > FORTNIGHT);
// Картинка товару у списку — розміри з макета.
const ART = {
  merch_cup: ["/assets/ui/merch.png", 30, 37],
  custom_print: ["/assets/ui/custom_print.png", 34, 34],
  coffee_250g: ["/assets/ui/coffee250.png", 28, 37],
};
const day = (iso) => new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
// ТТН групами по чотири: «2045 0912 3344».
export const ttnOf = (t) => String(t ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");

const Bean = ({ w = 15, h = 17 }) => <img src="/assets/ui/bean.png" alt="зерна" style={{ width: w, height: h }} />;

function statusLine(o) {
  if (o.status === "shipped" && o.ttn) return `${o.status_label} · ТТН ${ttnOf(o.ttn)}`;
  if (o.status === "received") return `${o.status_label} · ${day(o.status_changed_at)}`;
  if (o.status === "arrived" && o.kind === "postomat") return "Прибуло в поштомат";
  return o.status_label;
}
// Крапка статусу: у дорозі — акцент, отримано — зелена, решта — сіра.
const tone = (s) => (s === "shipped" || s === "arrived" ? "go" : s === "received" ? "ok" : "wait");

export function Orders({ ctx }) {
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState("active");
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/me/redemptions").then((r) => setOrders(r.orders)).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!orders) return <div className="stage-pad"><div className="skeleton" /></div>;

  const shown = orders.filter((o) => (tab === "done") === isDone(o));

  return (
    <div className="stage-pad">
      <div className="seg">
        <button data-on={tab === "active"} onClick={() => setTab("active")}>Активні</button>
        <button data-on={tab === "done"} onClick={() => setTab("done")}>Завершені</button>
      </div>

      {orders.length === 0 ? (
        <div className="panel muted">Замовлень ще немає. Кава, чашка й футболка з принтом купуються за зерна в Магазині.</div>
      ) : shown.length === 0 ? (
        <div className="panel muted">{tab === "active" ? "Усі замовлення вже отримані." : "Завершених замовлень ще немає."}</div>
      ) : (
        <div className="orders">
          {shown.map((o) => {
            const [src, w, h] = ART[o.product] ?? ["/assets/ui/coffee250.png", 28, 37];
            return (
              <button key={o.id} className="order-row" onClick={() => ctx.push("order", { id: o.id })}>
                <img src={src} alt="" style={{ width: w, height: h }} />
                <div className="order-row-main">
                  <div className="order-row-title">
                    <b>№{o.id} · {o.name}</b>
                    {o.unseen && <i>1</i>}
                  </div>
                  <small>{o.place}</small>
                  <span className="order-status" data-tone={tone(o.status)}><i />{statusLine(o)}</span>
                </div>
                <div className="order-row-end">
                  <b><Bean />{o.beans}</b>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round">
                    <path d="M9.5 6 15.5 12 9.5 18" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="hint-chip">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" />
        </svg>
        Статуси оновлюються автоматично, коли Нова Пошта передає дані.
      </div>
    </div>
  );
}
