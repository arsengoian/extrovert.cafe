// Картка гравця: баланси, журнал, інвентар, кавенята, чат, крейти, покупки
// (docs/admin_panel.md, «Користувачі»).
//
// Читання й нічого більше: кнопки «нарахувати» чи «забанити» тут немає
// свідомо — дія без екрана, який пояснює наслідки, небезпечніша за її
// відсутність.
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const REASON = {
  purchase: "бонус за чек", care: "догляд", sapling: "саджанець", exchange: "обмін зерен",
  pos_discount: "знижка на POS", crate: "скринька", crate_opening: "відкриття скриньки",
  market: "маркет", transfer: "переказ", repost: "репост", chat: "чат", quiz: "опитування",
  delivery: "доставка", wardrobe_set: "комплект одягу",
};
const delta = (n, sign = "") => (n ? <b style={{ color: n > 0 ? "var(--ok)" : "var(--bad)" }}>{n > 0 ? "+" : ""}{fmt.int(n)}{sign}</b> : null);

export function User({ id }) {
  const { data, error } = useData(() => api.user(id), [id]);
  if (error) return <Empty>{error.status === 404 ? "немає такого гравця" : error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;
  const { user, identities, plants, ledger, items, chat, crates, receipts, orders } = data;

  return (
    <>
      <div className="head">
        <div>
          <h1>{user.nickname}{user.deleted_at && <span className="muted"> · видалений</span>}</h1>
          <p>
            {user.email ?? "без пошти"} · вхід: {identities.map((i) => i.provider).join(", ") || "дев"} ·
            {" "}з нами з {fmt.dayFull(user.created_at)} · остання поява {user.last_seen_at ? fmt.ago(user.last_seen_at) : "—"}
          </p>
        </div>
        <div className="right"><button className="btn" onClick={() => go("users")}>← до списку</button></div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Жовті монети" value={fmt.int(user.coins_yellow)} note="за покупки й активність" />
        <Kpi label="Срібні монети" value={fmt.int(user.coins_silver)} note="куплені за гривні" />
        <Kpi label="Боби" value={fmt.int(user.beans)} note="ростуть на кавенятку" />
        <Kpi
          label="Кавенята"
          value={fmt.int(plants.length)}
          note={plants.length ? `найстарше: стадія ${Math.max(...plants.map((p) => p.growth_stage))}` : "ще немає"}
        />
      </div>

      <div className="wrap-cols">
        <div className="stack">
          <Card title="Журнал" note={`останні ${ledger.length}`}>
            <div className="scroll">
              <Table
                columns={[
                  { key: "created_at", title: "коли", render: (l) => fmt.time(l.created_at) },
                  { key: "reason", title: "за що", render: (l) => REASON[l.reason] ?? l.reason },
                  { key: "y", title: "жовті", num: true, render: (l) => delta(l.delta_yellow) },
                  { key: "s", title: "срібні", num: true, render: (l) => delta(l.delta_silver) },
                  { key: "b", title: "боби", num: true, render: (l) => delta(l.delta_beans) },
                ]}
                rows={ledger}
                empty="рухів не було"
              />
            </div>
          </Card>

          <Card title="Покупки кави" note={`${receipts.length} чеків із зарахованим бонусом`}>
            <Table
              columns={[
                { key: "fiscal_date", title: "коли", render: (r) => fmt.time(r.fiscal_date) },
                { key: "point_id", title: "точка" },
                { key: "total_sum", title: "сума", num: true, render: (r) => fmt.uah(r.total_sum) },
                { key: "coins_yellow", title: "бонус", num: true, render: (r) => fmt.int(r.coins_yellow) },
              ]}
              rows={receipts}
              empty="бонусів за чеки ще не забирав"
            />
          </Card>
        </div>

        <div className="stack">
          <Card title="Кавенята">
            {plants.length === 0 ? <Empty>ще не посадив</Empty> : plants.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", fontSize: 12 }}>
                <span><b>{p.name ?? "без імені"}</b> <span className="muted">стадія {p.growth_stage} · {p.cycle_phase}</span></span>
                <span className="muted">{p.last_watered_at ? `полив ${fmt.ago(p.last_watered_at)}` : "не поливали"}</span>
              </div>
            ))}
          </Card>

          <Card title="Інвентар" note={`${items.length} речей`}>
            {items.length === 0 ? <Empty>порожньо</Empty> : (
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {items.map((i) => <Badge key={i.id} tone={i.tier === "epic" ? "accent" : ""}>{i.name}</Badge>)}
              </div>
            )}
          </Card>

          <Card title="Скриньки" note={`${crates.length} відкриттів`}>
            {crates.length === 0 ? <Empty>ще не відкривав</Empty> : crates.slice(0, 12).map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: "space-between", padding: "5px 0", fontSize: 11.5 }}>
                <span>{c.item ?? `${fmt.int(c.result_coins)} монет`} {c.was_duplicate && <span className="muted">· дубль</span>}</span>
                <span className="muted">{c.rolled_tier} · {fmt.ago(c.opened_at)}</span>
              </div>
            ))}
          </Card>

          <Card title="Чат із кавенятком" note={`${chat.length} повідомлень`}>
            {chat.length === 0 ? <Empty>не спілкувались</Empty> : (
              <div className="scroll" style={{ maxHeight: 220 }}>
                {[...chat].reverse().map((m) => (
                  <div key={m.id} style={{ padding: "5px 0", fontSize: 11.5 }}>
                    <span className="muted">{m.role === "user" ? "гравець" : "кавенятко"} · {fmt.time(m.created_at)}</span>
                    <div>{m.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {orders.length > 0 && (
            <Card title="Замовлення">
              {orders.map((o) => (
                <div key={o.id} className="row" style={{ justifyContent: "space-between", padding: "5px 0", fontSize: 11.5 }}>
                  <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`orders/${o.id}`)}>№{o.id} · {o.product}</button>
                  <span className="muted">{o.status}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
