// Повернення з банку. Статус не приходить сюди сам: вебхук іде на сервер,
// а він може й запізнитись, тому екран перепитує api, доки не з'явиться
// відповідь. Сервер при цьому питає mono напряму — тож відповідь буде
// навіть якщо вебхук не дійшов узагалі.
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { coins as coinsWord } from "../ui/plural.js";
import { PENDING_KEY } from "./CoinPacks.jsx";

const TRY_FOR_MS = 60_000;
const EVERY_MS = 2000;

export function PaymentResult({ ctx, invoiceId }) {
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);
  const startedAt = useRef(Date.now());

  const id = invoiceId ?? localStorage.getItem(PENDING_KEY);

  useEffect(() => {
    if (!id) { setError("Не знайшли, який саме платіж перевіряти"); return undefined; }
    let alive = true;
    let timer = null;

    const tick = async () => {
      try {
        const r = await api.get(`/me/payments/${encodeURIComponent(id)}`);
        if (!alive) return;
        setPayment(r);
        if (r.credited || ["failure", "expired", "reversed"].includes(r.status)) {
          localStorage.removeItem(PENDING_KEY);
          await ctx.refreshMe();
          return;
        }
        if (Date.now() - startedAt.current < TRY_FOR_MS) timer = setTimeout(tick, EVERY_MS);
      } catch (e) {
        if (alive) setError(e.body?.error === "no_such_payment" ? "Такого платежу немає" : e.message);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  const waited = payment && !payment.credited && Date.now() - startedAt.current >= TRY_FOR_MS;

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 54, margin: "6px auto 10px" }} />
        {error && <div className="h2">{error}</div>}

        {!error && payment?.credited && (
          <>
            <div className="h2">+{coinsWord(payment.coins)}</div>
            <p className="muted">Оплату на {payment.amount_uah} ₴ отримано, монети вже в гаманці.</p>
          </>
        )}

        {!error && payment && !payment.credited && ["failure", "expired", "reversed"].includes(payment.status) && (
          <>
            <div className="h2">Оплата не пройшла</div>
            <p className="muted">
              Гроші не списані. Якщо банк усе ж їх зняв – напиши через «Повідомити про проблему»,
              розберемось із чеком на руках.
            </p>
          </>
        )}

        {!error && (!payment || (!payment.credited && !["failure", "expired", "reversed"].includes(payment.status))) && (
          <>
            <div className="h2">{waited ? "Банк ще думає" : "Перевіряємо оплату…"}</div>
            <p className="muted">
              {waited
                ? "Буває, що підтвердження йде довше. Монети зарахуються самі – загляни в гаманець за кілька хвилин."
                : "Це кілька секунд."}
            </p>
          </>
        )}

        <button className="btn btn-primary" onClick={() => ctx.openTab("wallet")}>У гаманець</button>
      </div>
    </div>
  );
}
