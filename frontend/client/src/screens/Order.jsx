// Картка замовлення — кадр «Мої замовлення · картка»: товар, таймлайн
// статусів (пройдені — акцентом, поточний — з ореолом, майбутні — сірим),
// ТТН із кнопкою «копіювати» й дві дії внизу.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ttnOf } from "./Orders.jsx";

const ART = {
  merch_cup: ["/assets/ui/merch.png", 36, 44],
  custom_print: ["/assets/ui/custom_print.png", 42, 42],
  coffee_250g: ["/assets/ui/coffee250.png", 33, 44],
};
const LABEL = { new: "Нове", printing: "Друкуємо", packing: "Пакуємо", shipped: "Відправлено", arrived: "Прибуло у відділення", received: "Отримано" };
const when = (iso) => new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const Bean = () => <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 14, height: 16 }} />;

export function Order({ id, ctx }) {
  const [order, setOrder] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  // Відкрив картку — сервер гасить лічильник; перечитуємо профіль, щоб
  // бейдж на вкладці Магазину зник одразу.
  useEffect(() => {
    api.get(`/me/redemptions/${id}`).then((o) => { setOrder(o); ctx.refreshMe().catch(() => {}); }).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!order) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Друк є лише у футболки з принтом; поштомат — «прибуло в поштомат».
  const steps = ["new", ...(order.product === "custom_print" ? ["printing"] : []), "packing", "shipped", "arrived", "received"];
  const current = steps.indexOf(order.status);
  const event = (s) => order.events.find((e) => e.status === s);
  const [src, w, h] = ART[order.product] ?? ART.coffee_250g;

  const copy = async () => {
    try { await navigator.clipboard.writeText(order.ttn); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* без дозволу */ }
  };

  const sub = (s) => {
    const e = event(s);
    if (!e) return null;
    if (s === "new") return <>{when(e.created_at)} · <Bean /> списано</>;
    if (s === "packing") return `${when(e.created_at)} · скасувати вже не можна`;
    return when(e.created_at);
  };

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="co-product">
        <img src={src} alt="" style={{ width: w, height: h }} />
        <div className="co-name plain">
          <b>{order.name}</b>
          <small className="order-meta">{order.beans} <Bean /> · {order.place}</small>
        </div>
      </div>

      <div className="timeline">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "now" : "next";
          const title = s === "arrived" && order.kind === "postomat" ? "Прибуло в поштомат" : LABEL[s];
          return (
            <div className="tl-step" key={s} data-state={state}>
              <div className="tl-rail"><i />{i < steps.length - 1 && <span data-lit={i < current || undefined} />}</div>
              <div className="tl-body" data-last={i === steps.length - 1 || undefined}>
                <b>{title}</b>
                {state !== "next" && sub(s) && <small>{sub(s)}</small>}
                {s === "shipped" && state !== "next" && order.ttn && (
                  <div className="tl-ttn">
                    <span>ТТН {ttnOf(order.ttn)}</span>
                    <button onClick={copy}>{copied ? "скопійовано" : "копіювати"}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="order-actions">
        <button className="order-problem" onClick={() => ctx.push("problem")}>Проблема із замовленням</button>
        <button className="order-track" disabled={!order.ttn}
                onClick={() => window.open(`https://novaposhta.ua/tracking/?cargo_number=${order.ttn}`, "_blank", "noopener")}>
          Відстежити
        </button>
      </div>
    </div>
  );
}
