// Історія деплойментів цін: що, коли й куди поїхало (docs/admin_panel.md).
import { useState } from "react";
import { api } from "../api.js";
import { Badge, Empty, Table, fmt, useData } from "../ui.jsx";

const STATUS = {
  queued: ["", "у черзі"], deploying: ["warn", "котиться"], done: ["ok", "готово"],
  partial: ["warn", "частково"], failed: ["bad", "впало"],
};
const badge = (s) => { const [tone, text] = STATUS[s] ?? ["", s]; return <Badge tone={tone}>{text}</Badge>; };

export function Deployments() {
  const { data, error, reload } = useData(() => api.deployments());
  const { data: prices } = useData(() => api.prices());
  const [note, setNote] = useState(null);
  const [drink, setDrink] = useState("");
  // Напої для вибору знижки: активні, не бонусні, у порядку меню.
  const drinks = (prices?.drinks ?? []).filter((d) => d.active && !d.is_bonus);
  // Тестова знижка: та сама черга знижок, що й купівля (lib/discounts.js),
  // на один обраний напій (власник, 08.10.2026) на всіх точках — подивитись
  // плашку з відліком і знижену ціну саме цього напою на кіоску.
  const discount = async () => {
    const slot = drink || drinks[0]?.slot;
    const name = drinks.find((d) => d.slot === slot)?.name ?? "напій";
    if (!slot) { setNote("немає активних напоїв"); return; }
    if (!confirm(`Увімкнути тестову знижку на «${name}»? Ціна цього напою на екрані кіоска на дві хвилини (або до першого чека з ним) стане нижчою.`)) return;
    try {
      const r = await api.discountTest({ drink: slot });
      setNote(r.status === "active"
        ? `Знижка ${r.uah} ₴ на «${r.drink_name}» до ${new Date(r.until).toLocaleTimeString("uk-UA")} або першого чека`
        : `Знижка на «${r.drink_name}» в черзі: перед нею ${r.ahead}`);
      reload();
    } catch (e) { setNote(`не вийшло: ${e.message}`); }
  };
  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Історія деплойментів</h1>
          <p>останні 50 – ціни їдуть у публічний бакет, звідки їх бере точка</p>
        </div>
        <div className="right">
          {note && <span className="muted">{note}</span>}
          <select className="btn" value={drink} onChange={(e) => setDrink(e.target.value)} aria-label="напій знижки">
            <option value="">напій знижки…</option>
            {drinks.map((d) => <option key={d.slot} value={d.slot}>{d.name}</option>)}
          </select>
          <button className="btn" onClick={discount}>Тестова знижка</button>
          <button className="btn" onClick={reload}>Оновити</button>
        </div>
      </div>

      <Table
        columns={[
          { key: "id", title: "№", render: (d) => <b>{d.id}</b> },
          { key: "status", title: "стан", render: (d) => badge(d.status) },
          { key: "created_at", title: "створений", render: (d) => <span>{fmt.time(d.created_at)}<small>{d.created_by ?? "система"}</small></span> },
          { key: "finished_at", title: "завершений", render: (d) => (d.finished_at ? fmt.time(d.finished_at) : <span className="muted">—</span>) },
          {
            key: "targets", title: "цілі", render: (d) => (
              <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(d.targets ?? []).map((t) => (
                  <span key={`${t.point_id}-${t.kind}`} title={t.error ?? ""}>
                    <Badge tone={STATUS[t.status]?.[0] ?? ""}>{t.name} ({t.kind})</Badge>
                  </span>
                ))}
                {!d.targets?.length && <span className="muted">—</span>}
              </span>
            ),
          },
        ]}
        rows={data.deployments}
        empty="деплойментів ще не було"
      />
    </>
  );
}
