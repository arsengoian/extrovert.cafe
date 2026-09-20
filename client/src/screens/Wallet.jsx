// Гаманець: три баланси, способи заробити й історія операцій.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

const REASONS = {
  purchase: "покупка кави", quiz: "квіз", repost: "репост", crate: "скринька",
  care: "догляд", chat: "чат", transfer: "переказ", market: "маркет",
  exchange: "обмін", pos_discount: "знижка на POS", delivery: "доставка",
  sapling: "саджанець", admin: "нарахування вручну",
};

export function Wallet({ ctx }) {
  const [entries, setEntries] = useState(null);
  const b = ctx.me?.balances ?? {};

  useEffect(() => { api.get("/me/ledger").then((r) => setEntries(r.entries)).catch(() => setEntries([])); }, []);

  return (
    <div className="stage-pad">
      <div className="panel">
        <div className="row-between">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Жовті монети</div>
            <div style={{ fontSize: 26, fontWeight: 900 }}>{fmt(b.yellow)}</div>
          </div>
          <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 40 }} />
        </div>
        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <div className="panel" style={{ flex: 1, padding: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>Срібні</div>
            <div style={{ fontWeight: 800 }}>{fmt(b.silver)}</div>
          </div>
          <div className="panel" style={{ flex: 1, padding: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>Зерна</div>
            <div style={{ fontWeight: 800 }}>{fmt(b.beans)}</div>
          </div>
        </div>
      </div>

      <div className="sectionTitle">Заробити</div>
      <div className="grid2">
        <button className="btn" onClick={() => ctx.push("quizProfile")}>Розкажи про себе</button>
        <button className="btn" onClick={() => ctx.push("repost")}>Репост</button>
        <button className="btn" onClick={() => ctx.push("coinPacks")}>Купити монети</button>
        <button className="btn" onClick={() => ctx.push("transfer")}>Переказати</button>
      </div>

      <div className="sectionTitle">Історія</div>
      {entries === null && <div className="skeleton" />}
      {entries?.length === 0 && <div className="panel muted">Поки порожньо: перша кава — перші монети.</div>}
      {entries?.map((e) => (
        <div key={e.id} className="panel" style={{ padding: 12 }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 700 }}>{REASONS[e.reason] ?? e.reason}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {new Date(e.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div style={{ textAlign: "right", fontWeight: 800 }}>
              {e.delta_yellow ? <div>{e.delta_yellow > 0 ? "+" : ""}{fmt(e.delta_yellow)} <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 14, display: "inline" }} /></div> : null}
              {e.delta_silver ? <div>{e.delta_silver > 0 ? "+" : ""}{fmt(e.delta_silver)} <img src="/assets/ui/coin_silver.png" alt="" style={{ width: 14, display: "inline" }} /></div> : null}
              {e.delta_beans ? <div>{e.delta_beans > 0 ? "+" : ""}{fmt(e.delta_beans)} <img src="/assets/ui/bean.png" alt="" style={{ width: 13, display: "inline" }} /></div> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
