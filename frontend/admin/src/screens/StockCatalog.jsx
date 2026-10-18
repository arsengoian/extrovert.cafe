// «Залишки» → матеріали й рецепти (docs/stock.md). Матеріали — що рахуємо
// й у чому. Рецепти — версіями, кожна чинна від своєї дати: витрата за
// замовленням рахується за версією, чинною на мить покупки. Склад напою
// (грами, вода) — з резервної копії рецептів машини (імпорт нижче), стакан і
// кришка — за меню, а частку тих, хто бере кришку, мішалку, цукор, задаємо
// тут (норми самообслуговування); інвентаризація покаже, яка вона насправді.
import { useState } from "react";
import { api } from "../api.js";
import { Badge, Card, Empty, Table, fmt, useData } from "../ui.jsx";
import { readZip } from "../zip.js";
import { KIND, errorText, fromLocal, localInput, unitLabel } from "./Stock.jsx";

const UNIT_SHORT = { g: "г", ml: "мл", pcs: "шт" };
const pct = (v) => `${Math.round(v * 1000) / 10} %`;

export function StockCatalog() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Матеріали й рецепти</h1>
          <p>що рахуємо на складі, і скільки чого йде в кожен напій — версіями, від дати</p>
        </div>
      </div>
      <Recipes />
      <Items />
    </>
  );
}

// ── матеріали ───────────────────────────────────────────────────────────
const emptyItem = { id: "", name: "", unit: "g", kind: "ingredient", pack_size: "", pack_name: "", per_day: "", canister: "", sort_order: "", note: "", active: true };

function Items() {
  const { data, error, reload } = useData(() => api.stockItems(), []);
  const [edit, setEdit] = useState(null);   // { isNew, ...поля }
  const [flash, setFlash] = useState(null);
  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const save = async () => {
    setFlash(null);
    const body = {
      name: edit.name, kind: edit.kind, pack_name: edit.pack_name, note: edit.note, active: edit.active,
      pack_size: edit.pack_size === "" ? null : Number(edit.pack_size),
      per_day: edit.per_day === "" ? 0 : Number(edit.per_day),
      canister: edit.canister === "" ? null : Number(edit.canister),
      sort_order: edit.sort_order === "" ? 0 : Number(edit.sort_order),
    };
    try {
      await api.stockItemSave(edit.isNew ? null : edit.id, edit.isNew ? { ...body, id: edit.id, unit: edit.unit } : body);
      setEdit(null);
      reload();
    } catch (e) {
      setFlash(errorText(e));
    }
  };
  const field = (key, label, props = {}) => (
    <label className="promo-field"><span>{label}</span>
      <input value={edit[key] ?? ""} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} {...props} /></label>
  );

  return (
    <>
      <div className="row between" style={{ margin: "22px 0 10px" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Матеріали</h2>
        <button className="btn small" onClick={() => setEdit({ ...emptyItem, isNew: true })}>+ матеріал</button>
      </div>
      {edit && (
        <Card title={edit.isNew ? "Новий матеріал" : edit.name} style={{ marginBottom: 12 }}>
          <div className="promo-form">
            {edit.isNew && field("id", "Код", { placeholder: "латиницею: oat_milk", maxLength: 40 })}
            {field("name", "Назва", { maxLength: 120 })}
            {edit.isNew && (
              <label className="promo-field"><span>Одиниця</span>
                <select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>
                  <option value="g">грами (показуємо кг)</option><option value="ml">мілілітри (показуємо л)</option><option value="pcs">штуки</option>
                </select></label>
            )}
            <label className="promo-field"><span>Тип</span>
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {Object.entries(KIND).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select></label>
            {field("pack_size", `Пачка, ${UNIT_SHORT[edit.unit]}`, { inputMode: "decimal", placeholder: "скільки в одній упаковці" })}
            {field("pack_name", "Пачка — як звати", { placeholder: "пачка 1 кг", maxLength: 60 })}
            {field("per_day", `Щодоби, ${UNIT_SHORT[edit.unit]}`, { inputMode: "decimal", placeholder: "витрата незалежно від продажів" })}
            {field("canister", "Бункер машини", { inputMode: "numeric", placeholder: "170 — зерно, 2 — молоко, 0 — вода" })}
            {field("sort_order", "Порядок", { inputMode: "numeric" })}
            {field("note", "Примітка", { maxLength: 500 })}
            <label className="promo-field"><span>Активний</span>
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} style={{ width: 18, height: 18 }} /></label>
            {flash && <p className="promo-note">{flash}</p>}
            <div className="row">
              <button className="btn primary" onClick={save}>зберегти</button>
              <button className="btn" onClick={() => { setEdit(null); setFlash(null); }}>скасувати</button>
            </div>
          </div>
        </Card>
      )}
      <Table
        onRow={(i) => setEdit({ ...i, isNew: false, pack_size: i.pack_size ?? "", per_day: i.per_day || "", canister: i.canister ?? "", sort_order: i.sort_order ?? "", note: i.note ?? "", pack_name: i.pack_name ?? "" })}
        columns={[
          { key: "name", title: "матеріал", render: (i) => <span>{i.name}<small>{i.id}{!i.active && " · неактивний"}</small></span> },
          { key: "kind", title: "тип", render: (i) => KIND[i.kind] },
          { key: "unit", title: "одиниця", render: (i) => unitLabel(i.unit) },
          { key: "pack", title: "пачка", render: (i) => (i.pack_size ? `${i.pack_name ?? ""} (${fmt.int(i.pack_size)} ${UNIT_SHORT[i.unit]})` : <span className="muted">—</span>) },
          { key: "canister", title: "бункер", num: true, render: (i) => i.canister ?? <span className="muted">—</span> },
          { key: "per_day", title: "щодоби", num: true, render: (i) => (i.per_day ? `${i.per_day} ${UNIT_SHORT[i.unit]}` : <span className="muted">—</span>) },
          { key: "unit_cost", title: "ціна одиниці", num: true, render: (i) => (i.unit_cost !== null ? `${i.unit_cost.toLocaleString("uk-UA", { maximumFractionDigits: 3 })} ₴/${UNIT_SHORT[i.unit]}` : <span className="muted">—</span>) },
          { key: "last_bought", title: "остання закупка", render: (i) => (i.last_bought ? fmt.dayFull(i.last_bought) : <span className="muted">—</span>) },
        ]}
        rows={data.items}
        empty="матеріалів немає"
      />
    </>
  );
}

// ── рецепти ─────────────────────────────────────────────────────────────
function Recipes() {
  const [version, setVersion] = useState(null);
  const { data, error, reload } = useData(() => api.stockRecipes(version ?? undefined), [version]);
  const [flash, setFlash] = useState(null);
  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;
  const v = data.version;
  const items = new Map(data.items.map((i) => [i.id, i]));
  const drinks = new Map(data.drinks.map((d) => [d.product_id, d]));
  const name = (p) => (p === 0 ? "на кожен напій" : drinks.get(p)?.name ?? v?.products?.[p] ?? `продукт ${p}`);
  const products = v ? [...new Set(v.lines.map((l) => l.product_id))].sort((a, b) => (a === 0) - (b === 0) || a - b) : [];
  const cols = v ? [...new Set(v.lines.map((l) => l.item_id))].sort((a, b) => data.items.findIndex((i) => i.id === a) - data.items.findIndex((i) => i.id === b)) : [];
  const cell = (p, item) => v.lines.find((l) => l.product_id === p && l.item_id === item);

  const remove = async () => {
    if (!window.confirm(`Прибрати версію від ${fmt.time(v.valid_from)}? Витрата за замовленнями після неї перерахується за попередньою.`)) return;
    try {
      await api.stockRecipeDelete(v.id);
      setVersion(null);
      reload();
    } catch (e) {
      setFlash(errorText(e));
    }
  };

  return (
    <>
      <div className="row between" style={{ margin: "0 0 10px", flexWrap: "wrap", gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Рецепти</h2>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 330 }}>
            <select value={v?.id ?? ""} onChange={(e) => setVersion(Number(e.target.value))}>
              {data.versions.map((x) => (
                <option key={x.id} value={x.id}>
                  від {fmt.time(x.valid_from)} · {x.source === "machine" ? "з машини" : "правка"}{x.id === data.current_id ? " · чинна" : ""}
                </option>
              ))}
            </select>
          </label>
          {v && data.versions.length > 1 && <button className="btn small" onClick={remove}>прибрати версію</button>}
        </div>
      </div>
      {flash && <p className="promo-note" style={{ marginBottom: 10 }}>{flash}</p>}
      {!v ? <Empty>рецептів ще немає — імпортуйте резервну копію машини</Empty> : (
        <>
          <p className="muted" style={{ margin: "0 0 8px" }}>{v.note ?? ""}</p>
          <Table
            scroll
            columns={[
              { key: "product", title: "напій", render: (r) => <span>{name(r.product)}{r.product > 0 && <small>продукт {r.product}</small>}</span> },
              ...cols.map((item) => ({
                key: item, title: `${items.get(item)?.name ?? item}`, num: true, render: (r) => {
                  const l = cell(r.product, item);
                  if (!l) return <span className="muted">·</span>;
                  return <span>{l.qty.toLocaleString("uk-UA")} {UNIT_SHORT[items.get(item)?.unit] ?? ""}{l.take_rate < 1 && <small>бере {pct(l.take_rate)}</small>}</span>;
                },
              })),
            ]}
            rows={products.map((p) => ({ id: p, product: p }))}
            empty="у версії немає рядків"
          />
          {v.id === data.current_id && (
            <div className="wrap-cols" style={{ marginTop: 12 }}>
              <Norms key={v.id} version={v} items={data.items} onSaved={() => { setVersion(null); reload(); }} />
              <Import onSaved={() => { setVersion(null); reload(); }} />
            </div>
          )}
        </>
      )}
      {!v && <div style={{ marginTop: 12 }}><Import onSaved={() => { setVersion(null); reload(); }} /></div>}
    </>
  );
}

// Норми самообслуговування: яка частка покупців бере кришку (на кожен
// стакан M чи L), мішалку, цукор, серветку, трубочку. Збереження — нова
// версія рецептів від обраної дати; решта рядків переходить у неї як є.
function Norms({ version, items, onSaved }) {
  const lidItems = [...new Set(version.lines.filter((l) => l.product_id > 0 && /^lid/.test(l.item_id)).map((l) => l.item_id))];
  const selfItems = items.filter((i) => i.kind === "consumable" || (i.kind === "packaging" && !/^cup/.test(i.id) && !/^lid/.test(i.id)));
  const rateOf = (item) => {
    const l = version.lines.find((x) => x.item_id === item && (x.product_id === 0 || /^lid/.test(item)));
    return l ? String(Math.round(l.take_rate * 1000) / 10) : "";
  };
  const [rates, setRates] = useState(() => Object.fromEntries([...lidItems, ...selfItems.map((i) => i.id)].map((id) => [id, rateOf(id)])));
  const [from, setFrom] = useState(localInput());
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const label = (id) => items.find((i) => i.id === id)?.name ?? id;

  const save = async () => {
    setFlash(null);
    const parse = (v) => (v === "" ? null : Number(String(v).replace(",", ".")) / 100);
    for (const [id, v] of Object.entries(rates)) {
      const r = parse(v);
      if (r !== null && !(r > 0 && r <= 1)) { setFlash(`${label(id)}: частка від 0 до 100 %`); return; }
    }
    // Кришки — у кожному рядку напою з цією кришкою; самообслуговування —
    // рядки «на кожен напій» (product_id 0): порожнє поле — норми немає.
    const lines = version.lines
      .filter((l) => !(l.product_id === 0 && rates[l.item_id] !== undefined))
      .map((l) => (lidItems.includes(l.item_id) && parse(rates[l.item_id]) !== null ? { ...l, take_rate: parse(rates[l.item_id]) } : l))
      .filter((l) => !(lidItems.includes(l.item_id) && parse(rates[l.item_id]) === null));
    for (const i of selfItems) {
      const r = parse(rates[i.id]);
      if (r !== null) lines.push({ product_id: 0, item_id: i.id, qty: 1, take_rate: r });
    }
    setBusy(true);
    try {
      await api.stockRecipeSave({ valid_from: fromLocal(from), note: note || "норми самообслуговування", lines });
      onSaved();
    } catch (e) {
      setFlash(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card title="Норми самообслуговування" note="яка частка покупців бере; порожньо — норми немає">
      <div className="promo-form">
        {[...lidItems, ...selfItems.map((i) => i.id)].map((id) => (
          <label key={id} className="promo-field"><span>{label(id)}</span>
            <span className="row" style={{ gap: 6 }}>
              <input inputMode="decimal" value={rates[id] ?? ""} onChange={(e) => setRates({ ...rates, [id]: e.target.value })} placeholder="—" style={{ width: 90 }} />
              <span className="muted small">% {/^lid/.test(id) ? "стаканів свого розміру" : "напоїв"}</span>
            </span></label>
        ))}
        <label className="promo-field"><span>Діє від</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="promo-field"><span>Примітка</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="звідки така частка" maxLength={500} /></label>
        {flash && <p className="promo-note">{flash}</p>}
        <div><button className="btn primary" disabled={busy} onClick={save}>{busy ? "зберігаємо…" : "нова версія з цими нормами"}</button></div>
      </div>
    </Card>
  );
}

// Імпорт резервної копії рецептів машини: zip «Recipe_Product_Zip_…» як є
// або два файли з нього (*.product, *.recipe). Спершу показуємо, що зміниться
// проти чинної версії, і лише тоді створюємо нову.
function Import({ onSaved }) {
  const [backup, setBackup] = useState(null);   // { products, recipes, file }
  const [preview, setPreview] = useState(null);
  const [from, setFrom] = useState(localInput());
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = async (files) => {
    setFlash(null);
    setPreview(null);
    try {
      let texts = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          for (const e of await readZip(f)) if (/\.(product|recipe)$/i.test(e.name)) texts.push([e.name, await e.text()]);
        } else texts.push([f.name, await f.text()]);
      }
      const products = texts.find(([n]) => /\.product$/i.test(n));
      const recipes = texts.find(([n]) => /\.recipe$/i.test(n));
      if (!products || !recipes) throw new Error("потрібні обидва файли: *.product і *.recipe (або zip із ними)");
      const b = { products: JSON.parse(products[1]), recipes: JSON.parse(recipes[1]), file: files.map((f) => f.name).join(", ") };
      setBackup(b);
      setPreview(await api.stockRecipeImport({ valid_from: fromLocal(from), products: b.products, recipes: b.recipes, dry_run: true }));
    } catch (e) {
      setFlash(e.body ? errorText(e) : e.message);
    }
  };
  const save = async () => {
    setBusy(true);
    setFlash(null);
    try {
      await api.stockRecipeImport({ valid_from: fromLocal(from), products: backup.products, recipes: backup.recipes, note: `резервна копія машини: ${backup.file}` });
      onSaved();
    } catch (e) {
      setFlash(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card title="Імпорт із машини" note="резервна копія рецептів (portal → upload recipe)">
      <div className="promo-form">
        <label className="promo-field"><span>Файл</span>
          <input type="file" accept=".zip,.product,.recipe,application/json" multiple onChange={(e) => pick([...e.target.files])} /></label>
        <label className="promo-field"><span>Діє від</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        {flash && <p className="promo-note">{flash}</p>}
        {preview && (preview.changes.length === 0
          ? <p className="muted">рецепти в копії такі самі, як чинні, — нова версія не потрібна</p>
          : (
            <>
              <div className="stack" style={{ gap: 4, fontSize: 11.5 }}>
                {preview.changes.map((c) => (
                  <span key={`${c.product_id}-${c.item_id}`}>
                    <Badge tone={c.before === null ? "ok" : c.after === null ? "bad" : "warn"}>{c.before === null ? "нове" : c.after === null ? "прибрано" : "змінено"}</Badge>{" "}
                    {preview.names?.[c.product_id] ?? `продукт ${c.product_id}`} · {c.item_id}: {c.before ?? "—"} → {c.after ?? "—"}
                  </span>
                ))}
              </div>
              <div><button className="btn primary" disabled={busy} onClick={save}>{busy ? "створюємо…" : `нова версія від ${fmt.time(fromLocal(from))}`}</button></div>
            </>
          ))}
      </div>
    </Card>
  );
}
