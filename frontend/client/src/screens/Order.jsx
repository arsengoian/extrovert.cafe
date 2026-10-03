// Картка замовлення — кадр «Мої замовлення · картка»: товар, таймлайн
// статусів (пройдені — акцентом, поточний — з ореолом, майбутні — сірим),
// ТТН із кнопкою «копіювати» й дві дії внизу.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ttnOf } from "./Orders.jsx";
import { uploadPrint } from "../plant/print.js";
import { toast } from "../ui/Net.jsx";

const ART = {
  merch_cup: ["/assets/ui/merch.webp", 36, 44],
  custom_print: ["/assets/ui/custom_print.webp", 42, 42],
  coffee_250g: ["/assets/ui/coffee250.webp", 33, 44],
};
const LABEL = { new: "Нове", printing: "Друкуємо", packing: "Пакуємо", shipped: "Відправлено", arrived: "Прибуло у відділення", received: "Отримано" };
const when = (iso) => new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const Bean = () => <img src="/assets/ui/bean.webp" alt="зерна" style={{ width: 14, height: 16 }} />;

// Принт чашки чи футболки — те кавенятко, яке друкуємо, і файл для друку.
// Якщо після оплати файл не доїхав (обрив звʼязку), домальовуємо його тут
// із того самого знімка, поки замовлення ще не пішло в друк.
function PrintCard({ order, onReady }) {
  const print = order.print;
  const [state, setState] = useState(null);   // drawing | failed
  useEffect(() => {
    if (print.url || !print.upload_url || state) return;
    setState("drawing");
    uploadPrint(print.snapshot, print.upload_url)
      .then((ok) => (ok ? api.post(`/me/redemptions/${order.id}/print`).then(onReady) : Promise.reject(new Error("upload"))))
      .catch(() => setState("failed"));
  }, [print.url, print.upload_url]);

  // Сам файл лежить у бакеті назавжди, а посилання на нього підписане на
  // годину від відкриття картки (delivery.js, printLinks): картка, що
  // провисіла відкритою довше, віддавала б «доступ заборонено». Тому свіже
  // посилання — в мить натискання (03.10.2026).
  const download = async (e) => {
    e.preventDefault();
    try {
      const fresh = await api.get(`/me/redemptions/${order.id}`);
      window.location.assign(fresh.print?.download_url ?? print.download_url);
    } catch (err) {
      if (!err.offline) toast("Не вдалось отримати файл – спробуй ще раз");
    }
  };

  return (
    <div className="order-print">
      {print.url
        ? <img src={print.url} alt={`принт: ${print.snapshot?.name ?? "кавенятко"}`} />
        : <span className="order-print-wait" />}
      <div>
        <b>Принт: {print.snapshot?.name || "кавенятко"}</b>
        <small>
          {print.url ? "Таким воно буде на виробі."
            : state === "failed" ? "Не вдалось підготувати файл – спробуй відкрити замовлення ще раз."
            : print.upload_url ? "Готуємо файл для друку…"
            : "Файл для друку ще не готовий."}
        </small>
        {print.download_url && <a className="co-link" href={print.download_url} download onClick={download}>Завантажити PNG</a>}
      </div>
    </div>
  );
}

export function Order({ id, ctx }) {
  const [order, setOrder] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  // Відкрив картку — сервер гасить лічильник; перечитуємо профіль, щоб
  // бейдж на вкладці Магазину зник одразу.
  const load = () => api.get(`/me/redemptions/${id}`).then((o) => { setOrder(o); ctx.refreshMe().catch(() => {}); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!order) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Друк — у товарів із принтом кавенятка: футболки й чашки (чашка
  // друкується з кавенятка з 27.09.2026); поштомат — «прибуло в поштомат».
  const printed = order.product === "custom_print" || order.product === "merch_cup";
  const steps = ["new", ...(printed ? ["printing"] : []), "packing", "shipped", "arrived", "received"];
  const current = steps.indexOf(order.status);
  const event = (s) => order.events.find((e) => e.status === s);
  const [src, w, h] = ART[order.product] ?? ART.coffee_250g;

  const copy = async () => {
    // Без дозволу на буфер кнопка мовчала — тепер тост (03.10.2026); сам
    // номер виділяється й копіюється вручну (.selectable).
    try { await navigator.clipboard.writeText(order.ttn); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast("Не вдалось скопіювати – виділи номер і скопіюй вручну"); }
  };

  const sub = (s) => {
    const e = event(s);
    if (!e) return null;
    if (s === "new") return <>{when(e.created_at)} – <Bean /> списано</>;
    if (s === "packing") return `${when(e.created_at)} – скасувати вже не можна`;
    return when(e.created_at);
  };

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="co-product">
        <img src={src} alt="" style={{ width: w, height: h }} />
        <div className="co-name plain">
          <b>{order.name}</b>
          <small className="order-meta">{order.beans} <Bean /><i className="vsep" /><span data-clarity-mask="True">{order.place}</span></small>
        </div>
      </div>

      {order.print && <PrintCard order={order} onReady={load} />}

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
                    {/* selectable: номер переносять у застосунок пошти
                        руками не рідше, ніж кнопкою «копіювати» */}
                    <span className="selectable">ТТН {ttnOf(order.ttn)}</span>
                    <button onClick={copy}>{copied ? "скопійовано" : "копіювати"}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="order-actions">
        {/* Із замовленням — у підтримку (Telegram-бот), а не у форму скарги
            на точку: та про кавомашину, а тут посилка (власник, 01.10.2026). */}
        <button className="order-problem" onClick={() => ctx.support()}>Проблема із замовленням</button>
        <button className="order-track" disabled={!order.ttn}
                onClick={() => window.open(`https://novaposhta.ua/tracking/?cargo_number=${order.ttn}`, "_blank", "noopener")}>
          Відстежити
        </button>
      </div>
    </div>
  );
}
