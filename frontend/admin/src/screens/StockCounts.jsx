// «Залишки» → інвентаризації (docs/stock.md): список, форма підрахунку
// (склад, полиці, бункери машини) і сторінка інвентаризації з порівнянням —
// скільки мало лишитись за закупками й рецептами, що прогнозував журнал за X
// днів до неї і скільки виявилось. Інвентаризація — джерело правди про
// кількість на мить підрахунку; правити й видаляти можна лише останню.
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, Card, Empty, Kpi, Pager, Table, fmt, useData, usePage } from "../ui.jsx";
import { KIND, errorText, fromLocal, fromShow, localInput, packs, qty, toShow, unitLabel } from "./Stock.jsx";

const STATUS = {
  ok: ["ok", "у межах допуску"], over: ["bad", "перевитрата"], surplus: ["warn", "лишилось більше"], info: ["", "без норми"],
};

export function StockCounts({ arg }) {
  if (arg === "new") return <CountForm />;
  const [id, mode] = String(arg ?? "").split("/");
  if (id && mode === "edit") return <CountForm id={Number(id)} />;
  if (id) return <CountDetail id={Number(id)} />;
  return <CountList />;
}

function CountList() {
  const [page, setPage] = usePage();
  const { data, error, loading } = useData(() => api.stockCounts({ page }), [page]);
  const head = (
    <div className="head">
      <div>
        <h1>Інвентаризації</h1>
        <p>фактичний підрахунок на складі, на полицях і в бункерах машини — від нього рахується залишок далі</p>
      </div>
      <div className="right"><button className="btn primary" onClick={() => go("stock/counts/new")}>+ інвентаризація</button></div>
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;
  return (
    <>
      {head}
      <Table
        onRow={(c) => go(`stock/counts/${c.id}`)}
        columns={[
          { key: "counted_at", title: "коли", render: (c) => <span>{fmt.time(c.counted_at)}{c.latest && <small>остання — можна правити</small>}</span> },
          { key: "items", title: "матеріалів", num: true, render: (c) => fmt.int(c.items) },
          { key: "over", title: "перевитрата", num: true, render: (c) => (c.over ? <Badge tone="bad">{c.over}</Badge> : <span className="muted">—</span>) },
          { key: "surplus", title: "лишилось більше", num: true, render: (c) => (c.surplus ? <Badge tone="warn">{c.surplus}</Badge> : <span className="muted">—</span>) },
          { key: "note", title: "примітка", render: (c) => c.note ?? <span className="muted">—</span> },
        ]}
        rows={data.counts}
        empty="інвентаризацій ще не було — залишок рахується від закупок"
        foot={<Pager info={data.page} onPage={setPage} busy={loading} />}
      />
    </>
  );
}

// Форма підрахунку: рядок — матеріал, колонка — місце. Порожня клітинка —
// «тут не рахували»; матеріал без жодного числа в інвентаризацію не
// потрапляє (часткова інвентаризація — нормально).
function CountForm({ id = null }) {
  const stock = useData(() => api.stock(), []);
  const existing = useData(() => (id ? api.stockCount(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  if (stock.error || existing.error) return <Empty>не вдалось прочитати: {(stock.error ?? existing.error).message}</Empty>;
  if (!stock.data || (id && !existing.data)) return <Empty>вантажимо…</Empty>;
  const { items, locations } = stock.data;
  const unitOf = new Map(items.map((i) => [i.id, i.unit]));
  if (!form) {
    const values = {};
    for (const r of existing.data?.rows ?? []) {
      for (const [loc, v] of Object.entries(r.locations)) values[`${r.item_id}|${loc}`] = toShow(r.unit, v);
    }
    setForm({
      counted_at: localInput(existing.data?.count.counted_at),
      note: existing.data?.count.note ?? "",
      values,
    });
    return null;
  }
  // Очікувано: для нової — розрахунок зараз, для правки — на мить тієї інвентаризації.
  const expected = new Map(id
    ? (existing.data.rows ?? []).map((r) => [r.item_id, r.expected])
    : items.map((i) => [i.id, i.book]));
  const total = (itemId) => {
    const vals = locations.map((l) => form.values[`${itemId}|${l.id}`]).filter((v) => v !== undefined && v !== "");
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + (fromShow(unitOf.get(itemId), v) || 0), 0);
  };
  const set = (key, v) => setForm({ ...form, values: { ...form.values, [key]: v } });

  const save = async () => {
    setBusy(true);
    setFlash(null);
    const lines = [];
    for (const [key, v] of Object.entries(form.values)) {
      if (v === "" || v === undefined) continue;
      const [item_id, location_id] = key.split("|");
      const value = fromShow(unitOf.get(item_id), v);
      if (Number.isNaN(value)) { setBusy(false); setFlash(`«${v}» — не число`); return; }
      lines.push({ item_id, location_id, qty: value });
    }
    try {
      const r = await api.stockCountSave(id, { counted_at: fromLocal(form.counted_at), note: form.note, lines });
      go(`stock/counts/${r.id}`);
    } catch (e) {
      setFlash(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>{id ? "Правимо інвентаризацію" : "Нова інвентаризація"}</h1>
          <p>кількість — у кг, л або штуках; порожня клітинка — тут не рахували</p>
        </div>
        <div className="right">
          <button className="btn" onClick={() => go(id ? `stock/counts/${id}` : "stock/counts")}>скасувати</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? "зберігаємо…" : "зберегти"}</button>
        </div>
      </div>
      {flash && <p className="promo-note" style={{ marginBottom: 10 }}>{flash}</p>}
      <Card style={{ marginBottom: 12 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label className="promo-field" style={{ minWidth: 300 }}>
            <span>Коли рахували</span>
            <input type="datetime-local" value={form.counted_at} onChange={(e) => setForm({ ...form, counted_at: e.target.value })} />
          </label>
          <label className="promo-field" style={{ flex: 1, minWidth: 260 }}>
            <span>Примітка</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} placeholder="хто рахував, що помітили" />
          </label>
        </div>
      </Card>
      <Table
        scroll
        columns={[
          { key: "name", title: "матеріал", render: (i) => <span>{i.name}<small>{unitLabel(i.unit)}{i.pack_name ? ` · ${i.pack_name}` : ""}</small></span> },
          ...locations.map((l) => ({
            key: l.id, title: l.name, render: (i) => (
              <input className="cell-input" inputMode="decimal" value={form.values[`${i.id}|${l.id}`] ?? ""}
                     onChange={(e) => set(`${i.id}|${l.id}`, e.target.value)} />
            ),
          })),
          { key: "total", title: "разом", num: true, render: (i) => { const t = total(i.id); return t === null ? <span className="muted">—</span> : <span>{qty(i.unit, t)}{packs(i, t) && <small>{packs(i, t)}</small>}</span>; } },
          { key: "expected", title: id ? "очікувалось" : "розрахунок зараз", num: true, render: (i) => qty(i.unit, expected.get(i.id) ?? null) },
          {
            key: "diff", title: "різниця", num: true, render: (i) => {
              const t = total(i.id), e = expected.get(i.id);
              if (t === null || e === null || e === undefined) return <span className="muted">—</span>;
              const d = t - e;
              return <span style={{ color: d < 0 ? "var(--bad)" : undefined }}>{d > 0 ? "+" : ""}{qty(i.unit, d)}</span>;
            },
          },
        ]}
        rows={items}
        empty="матеріалів немає"
      />
    </>
  );
}

function CountDetail({ id }) {
  const [x, setX] = useState(null);
  const { data, error, reload } = useData(() => api.stockCount(id, x ?? undefined), [id, x]);
  const [busy, setBusy] = useState(false);
  if (error) return <Empty>{error.status === 404 ? "немає такої інвентаризації" : `не вдалось прочитати: ${error.message}`}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;
  const { count, rows } = data;
  const n = (s) => rows.filter((r) => r.status === s).length;

  const remove = async () => {
    if (!window.confirm("Видалити цю інвентаризацію? Залишок знову рахуватиметься від попередньої.")) return;
    setBusy(true);
    try {
      await api.stockCountDelete(id);
      go("stock/counts");
    } catch (e) {
      window.alert(errorText(e));
      setBusy(false);
      reload();
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Інвентаризація {fmt.time(count.counted_at)}</h1>
          <p>{count.note ?? "без примітки"}{count.updated_at ? ` · виправлена ${fmt.time(count.updated_at)}` : ""}</p>
        </div>
        <div className="right">
          <label className="field" style={{ width: 210 }} title="з журналу: що обіцяв прогноз, зроблений за стільки днів до інвентаризації">
            <span className="muted small">прогноз за</span>
            <input type="number" min={1} max={60} value={x ?? data.compare_days} onChange={(e) => setX(Number(e.target.value) || null)} />
            <span className="muted small">дн. до</span>
          </label>
          <button className="btn" onClick={() => go("stock/counts")}>← усі</button>
          {count.latest && <button className="btn" onClick={() => go(`stock/counts/${id}/edit`)}>правити</button>}
          {count.latest && <button className="btn" disabled={busy} onClick={remove}>видалити</button>}
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Порахували" value={fmt.int(rows.length)} note="матеріалів у цій інвентаризації" />
        <Kpi label="Перевитрата" value={fmt.int(n("over"))} tone={n("over") ? "bad" : "ok"} note="витрачено більше, ніж мало б за продажами й рецептами" />
        <Kpi label="Лишилось більше" value={fmt.int(n("surplus"))} tone={n("surplus") ? "" : "ok"} note="рецепт завищує витрату чи закупку не внесено" />
        <Kpi label="У межах допуску" value={fmt.int(n("ok"))} note="допуск: більше з 5 % витрати, 2σ і пари одиниць" />
      </div>

      <Table
        scroll
        columns={[
          { key: "name", title: "матеріал", render: (r) => <span>{r.name}<small>{KIND[r.kind]}</small></span> },
          {
            key: "prev", title: "від", render: (r) => (r.prev
              ? <span>{qty(r.unit, r.prev.qty)}<small>інвентаризація {fmt.dayFull(r.prev.counted_at)}</small></span>
              : <span className="muted">{r.start ? `закупки з ${fmt.dayFull(r.start)}` : "—"}</span>),
          },
          { key: "bought", title: "+ закуплено", num: true, render: (r) => qty(r.unit, r.bought) },
          { key: "calc_used", title: "− витрата за рецептами", num: true, render: (r) => <span>{qty(r.unit, r.calc_used)}{r.calc_sd > 0 && <small>± {qty(r.unit, r.calc_sd)}</small>}</span> },
          { key: "expected", title: "= очікувано", num: true, render: (r) => qty(r.unit, r.expected) },
          {
            key: "actual", title: "факт", num: true, render: (r) => (
              <span title={Object.entries(r.locations).map(([l, v]) => `${l}: ${qty(r.unit, v)}`).join("\n")}>{qty(r.unit, r.actual)}</span>
            ),
          },
          {
            key: "diff", title: "різниця", num: true, render: (r) => (r.diff === null ? <span className="muted">—</span> : (
              <span style={{ color: r.status === "over" ? "var(--bad)" : r.status === "surplus" ? "var(--warn)" : undefined }}>
                {r.diff > 0 ? "+" : ""}{qty(r.unit, r.diff)}<small>допуск ± {qty(r.unit, r.margin)}</small>
              </span>
            )),
          },
          {
            key: "projection", title: `прогноз за ${data.compare_days} дн.`, num: true, render: (r) => (r.projection
              ? <span title={`розрахунок на ${fmt.dayFull(r.projection.as_of)}: ${qty(r.unit, r.projection.calc_then)}`}>
                  {qty(r.unit, r.projection.projected)}<small>± {qty(r.unit, r.projection.sd)}</small>
                </span>
              : <span className="muted">у журналі немає</span>),
          },
          {
            key: "rate", title: "на напій: факт / норма", num: true, render: (r) => (r.drinks && r.rate_actual !== null
              ? <span>{fmtRate(r.unit, r.rate_actual)} / {fmtRate(r.unit, r.rate_norm)}<small>{fmt.int(r.drinks)} {fmt.plural(r.drinks, "напій", "напої", "напоїв")} за період</small></span>
              : <span className="muted">—</span>),
          },
          { key: "status", title: "стан", render: (r) => { const [tone, text] = STATUS[r.status]; return <Badge tone={tone}>{text}</Badge>; } },
        ]}
        rows={rows}
        empty="у цій інвентаризації немає рядків"
      />
    </>
  );
}

// Частка на напій: штуки — у відсотках від чашок, грами й мілілітри — як є.
const fmtRate = (unit, v) => (v === null || v === undefined ? "—"
  : unit === "pcs" ? `${Math.round(v * 100)} %`
  : `${v.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} ${unit === "g" ? "г" : "мл"}`);
