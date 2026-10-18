// «Залишки» → закупки (docs/stock.md): документ із рядками — матеріал на
// склад (кількість і вартість) або інша витрата (обладнання, сервіси —
// CAPEX чи OPEX), щоб «Фінанси» бачили всі гроші, а не лише інгредієнти.
// Закупку можна виправити чи видалити: це журнал документів, а не
// інвентаризація.
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Card, Empty, Kpi, Pager, Table, fmt, useData, usePage } from "../ui.jsx";
import { errorText, fromLocal, fromShow, localInput, qty, toShow, unitLabel } from "./Stock.jsx";

const KINDS = [["material", "матеріал"], ["capex", "CAPEX"], ["opex", "OPEX"]];

export function StockPurchases({ arg }) {
  if (arg === "new") return <PurchaseForm />;
  if (arg) return <PurchaseForm id={Number(arg)} />;
  return <PurchaseList />;
}

function PurchaseList() {
  const [page, setPage] = usePage();
  const { data, error, loading } = useData(() => api.stockPurchases({ page }), [page]);
  const head = (
    <div className="head">
      <div>
        <h1>Закупки</h1>
        <p>матеріали на склад і решта витрат: обладнання, послуги, оренда</p>
      </div>
      <div className="right"><button className="btn primary" onClick={() => go("stock/purchases/new")}>+ закупка</button></div>
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;
  return (
    <>
      {head}
      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Матеріали" value={fmt.uah(data.totals.material)} note="усього закуплено на склад" />
        <Kpi label="CAPEX" value={fmt.uah(data.totals.capex)} note="обладнання, запуск точки" />
        <Kpi label="OPEX" value={fmt.uah(data.totals.opex)} note="поточні витрати, крім матеріалів" />
      </div>
      <Table
        onRow={(p) => go(`stock/purchases/${p.id}`)}
        columns={[
          { key: "received_at", title: "отримано", render: (p) => fmt.dayFull(p.received_at) },
          { key: "supplier", title: "постачальник", render: (p) => <span>{p.supplier ?? <span className="muted">—</span>}{p.doc && <small>{p.doc}</small>}</span> },
          {
            key: "lines", title: "позиції", render: (p) => (
              <span>{(p.lines ?? []).map((l) => (l.item_id ? `${l.item} ${qty(l.unit, l.qty)}` : `${l.description} (${l.kind.toUpperCase()})`)).join(", ")}</span>
            ),
          },
          { key: "total", title: "сума", num: true, render: (p) => fmt.uah(p.total) },
        ]}
        rows={data.purchases}
        empty="закупок ще немає"
        foot={<Pager info={data.page} onPage={setPage} busy={loading} />}
      />
    </>
  );
}

const blank = () => ({ kind: "material", item_id: "", category: "", description: "", qty: "", packs: "", cost_uah: "" });

function PurchaseForm({ id = null }) {
  const items = useData(() => api.stockItems(), []);
  const one = useData(() => (id ? api.stockPurchase(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  if (items.error || one.error) return <Empty>{one.error?.status === 404 ? "немає такої закупки" : `не вдалось прочитати: ${(items.error ?? one.error).message}`}</Empty>;
  if (!items.data || (id && !one.data)) return <Empty>вантажимо…</Empty>;
  const byId = new Map(items.data.items.map((i) => [i.id, i]));
  if (!form) {
    const found = one.data?.purchase ?? null;
    setForm({
      received_at: localInput(found?.received_at),
      supplier: found?.supplier ?? "", doc: found?.doc ?? "", note: found?.note ?? "",
      lines: found ? found.lines.map((l) => ({
        kind: l.kind, item_id: l.item_id ?? "", category: l.category ?? "", description: l.description ?? "",
        qty: l.item_id ? toShow(l.unit, l.qty) : "", packs: "", cost_uah: String(l.cost_uah),
      })) : [blank()],
    });
    return null;
  }
  const setLine = (i, patch) => setForm({ ...form, lines: form.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const total = form.lines.reduce((s, l) => s + (Number(String(l.cost_uah).replace(",", ".")) || 0), 0);

  const save = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const lines = form.lines.filter((l) => l.item_id || l.description || l.cost_uah).map((l) => ({
        kind: l.kind,
        item_id: l.kind === "material" ? l.item_id : null,
        category: l.kind === "material" ? null : l.category,
        description: l.description,
        qty: l.kind === "material" ? fromShow(byId.get(l.item_id)?.unit, l.qty) : null,
        cost_uah: Number(String(l.cost_uah).replace(",", ".")),
      }));
      await api.stockPurchaseSave(id, { received_at: fromLocal(form.received_at), supplier: form.supplier, doc: form.doc, note: form.note, lines });
      go("stock/purchases");
    } catch (e) {
      setFlash(errorText(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm("Видалити цю закупку? Залишок і фінанси перерахуються без неї.")) return;
    setBusy(true);
    try {
      await api.stockPurchaseDelete(id);
      go("stock/purchases");
    } catch (e) {
      setFlash(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>{id ? "Закупка" : "Нова закупка"}</h1>
          <p>матеріал — кількість у кг, л чи штуках (або пачками) і вартість рядка; решта — опис і сума</p>
        </div>
        <div className="right">
          <button className="btn" onClick={() => go("stock/purchases")}>скасувати</button>
          {id && <button className="btn" disabled={busy} onClick={remove}>видалити</button>}
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? "зберігаємо…" : "зберегти"}</button>
        </div>
      </div>
      {flash && <p className="promo-note" style={{ marginBottom: 10 }}>{flash}</p>}
      <Card style={{ marginBottom: 12 }}>
        <div className="promo-form">
          <label className="promo-field"><span>Отримано</span>
            <input type="datetime-local" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} /></label>
          <label className="promo-field"><span>Постачальник</span>
            <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} maxLength={120} /></label>
          <label className="promo-field"><span>Документ</span>
            <input value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} maxLength={200} placeholder="рахунок, накладна" /></label>
          <label className="promo-field"><span>Примітка</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} /></label>
        </div>
      </Card>
      <Table
        scroll
        columns={[
          {
            key: "kind", title: "тип", render: (l) => (
              <select className="cell-input" value={l.kind} onChange={(e) => setLine(l.n, { kind: e.target.value })}>
                {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ),
          },
          {
            key: "what", title: "матеріал / категорія", render: (l) => (l.kind === "material" ? (
              <select className="cell-input" value={l.item_id} onChange={(e) => setLine(l.n, { item_id: e.target.value })}>
                <option value="">— оберіть —</option>
                {items.data.items.filter((i) => i.active || i.id === l.item_id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            ) : (
              <input className="cell-input" value={l.category} onChange={(e) => setLine(l.n, { category: e.target.value })} placeholder="обладнання, оренда…" />
            )),
          },
          { key: "description", title: "опис", render: (l) => <input className="cell-input wide" value={l.description} onChange={(e) => setLine(l.n, { description: e.target.value })} placeholder={l.kind === "material" ? "як у документі (необовʼязково)" : "що саме"} /> },
          {
            key: "qty", title: "кількість", render: (l) => {
              const item = byId.get(l.item_id);
              if (l.kind !== "material") return <span className="muted">—</span>;
              return (
                <span className="row" style={{ gap: 6 }}>
                  <input className="cell-input" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.n, { qty: e.target.value, packs: "" })} />
                  <span className="muted small">{item ? unitLabel(item.unit) : ""}</span>
                  {item?.pack_size && (
                    <>
                      <input className="cell-input narrow" inputMode="decimal" value={l.packs} placeholder="пачок"
                             onChange={(e) => {
                               const n = Number(e.target.value.replace(",", "."));
                               setLine(l.n, { packs: e.target.value, qty: Number.isFinite(n) && e.target.value ? toShow(item.unit, n * item.pack_size) : l.qty });
                             }} />
                      <span className="muted small">× {item.pack_name}</span>
                    </>
                  )}
                </span>
              );
            },
          },
          { key: "cost", title: "вартість, ₴", render: (l) => <input className="cell-input" inputMode="decimal" value={l.cost_uah} onChange={(e) => setLine(l.n, { cost_uah: e.target.value })} /> },
          { key: "x", title: "", render: (l) => <button className="btn small" onClick={() => setForm({ ...form, lines: form.lines.filter((_, n) => n !== l.n) })}>×</button> },
        ]}
        rows={form.lines.map((l, n) => ({ ...l, n, id: n }))}
        empty="рядків немає"
        foot={(
          <span className="row between">
            <button className="btn small" onClick={() => setForm({ ...form, lines: [...form.lines, blank()] })}>+ рядок</button>
            <b>разом {fmt.uah(total)}</b>
          </span>
        )}
      />
    </>
  );
}
