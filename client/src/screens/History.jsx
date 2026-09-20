// Покупки: чеки з автомата разом із бонусами за них.
import { useEffect, useState } from "react";
import { api } from "../api.js";

export function History() {
  const [receipts, setReceipts] = useState(null);

  useEffect(() => { api.get("/me/history").then((r) => setReceipts(r.receipts)).catch(() => setReceipts([])); }, []);

  if (!receipts) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!receipts.length) {
    return (
      <div className="stage-pad">
        <div className="panel muted">
          Тут будуть покупки кави: кожен чек з автомата з бонусами, які ти за нього забрав.
        </div>
      </div>
    );
  }

  return (
    <div className="stage-pad">
      {receipts.map((r) => (
        <div key={r.id} className="panel">
          <div className="row-between">
            <div style={{ fontWeight: 800 }}>{new Date(r.fiscal_date).toLocaleDateString("uk-UA")}</div>
            <div className="price">{r.total_sum} ₴</div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{r.point_name}</div>
          {r.items.map((it, i) => (
            <div key={i} className="row-between" style={{ fontSize: 13 }}>
              <span>{it.name}{it.is_bonus ? " · бонусний" : ""}</span>
              <span className="muted">{it.sum} ₴</span>
            </div>
          ))}
          {r.bonus_coins ? (
            <div className="row" style={{ marginTop: 8, gap: 4 }}>
              <img src="/assets/ui/coin_gold.png" alt="" style={{ width: 16 }} />
              <span style={{ fontWeight: 700 }}>+{r.bonus_coins}</span>
              <span className="muted" style={{ fontSize: 12 }}>за цей чек</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
