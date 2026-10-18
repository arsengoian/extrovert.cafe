// «Залишки» (кавʼярня, docs/stock.md): скільки чого лежить — розрахунок
// від останньої інвентаризації, закупок і витрати за рецептами, — на
// скільки вистачить за прогнозом продажів і що з цим коштує. Інвентаризації,
// закупки, матеріали й рецепти — сусідні вкладки (StockCounts.jsx,
// StockPurchases.jsx, StockCatalog.jsx). Віддає api/src/routes/admin-stock.js.
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Line } from "../charts.jsx";
import { Badge, Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

// Одиниці: у базі г, мл, шт — на екрані кг, л, шт.
export const UNITS = { g: ["кг", 1000], ml: ["л", 1000], pcs: ["шт", 1] };
export const unitLabel = (unit) => UNITS[unit]?.[0] ?? unit;
export const toShow = (unit, v) => (v === null || v === undefined ? "" : String(Math.round((v / (UNITS[unit]?.[1] ?? 1)) * 1000) / 1000));
export const fromShow = (unit, v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n * (UNITS[unit]?.[1] ?? 1) : NaN;
};
export const qty = (unit, v, digits) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const [label, k] = UNITS[unit] ?? ["", 1];
  const x = v / k;
  const d = digits ?? (k === 1 ? 0 : Math.abs(x) < 10 ? 2 : 1);
  return `${x.toLocaleString("uk-UA", { maximumFractionDigits: d })} ${label}`;
};
export const packs = (item, v) => (item.pack_size && v !== null && v !== undefined
  ? `≈ ${(v / item.pack_size).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} × ${item.pack_name ?? "уп."}`
  : null);
export const daysText = (d) => (d === null || d === undefined ? "понад рік"
  : `${fmt.int(Math.floor(d))} ${fmt.plural(Math.floor(d), "день", "дні", "днів")}`);
// Поле datetime-local — у місцевому часі браузера.
export const localInput = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocal = (v) => new Date(v).toISOString();
export const KIND = { ingredient: "інгредієнт", packaging: "пакування", consumable: "витратне" };
// Помилки api людською мовою.
export const ERRORS = {
  not_after_latest: "інвентаризація має бути пізніша за останню",
  not_after_previous: "дата має бути пізніша за попередню інвентаризацію",
  not_latest: "правити й видаляти можна лише останню інвентаризацію",
  no_lines: "не заповнено жодного рядка",
  bad_qty: "кількість має бути числом",
  bad_cost: "вартість має бути числом ≥ 0",
  bad_description: "для витрати не матеріалом потрібен опис",
  version_exists: "версія з цією датою вже є",
  no_changes: "рецепти в копії такі самі, як чинні, — нова версія не потрібна",
  unknown_canister: "у копії є бункер, якого немає в матеріалах (поле «бункер»)",
  bad_backup: "у файлі немає ні напоїв, ні рецептів",
  no_recipes: "у копії не знайшлось рецептів до напоїв",
  last_version: "єдину версію рецептів прибрати не можна",
  item_exists: "матеріал із таким кодом уже є",
  canister_taken: "цей бункер уже призначений іншому матеріалу",
  bad_id: "код — латиниця, цифри й _, від 2 символів",
  counted_at_in_future: "дата в майбутньому", received_at_in_future: "дата в майбутньому", valid_from_in_future: "дата в майбутньому",
};
export const errorText = (e) => ERRORS[e.body?.error] ?? e.body?.error ?? e.message;

const STATUS = { ok: ["ok", "вистачає"], low: ["bad", "мало"], unknown: ["", "невідомо"], nonorm: ["", "без норми"] };

// Графік одного матеріалу: розрахунковий залишок з журналу й прогноз на
// 30 днів — середнє й нижня межа 90 % (з такою ймовірністю залишок не
// впаде нижче за неї).
function ItemChart({ item }) {
  const { data } = useData(() => api.stockHistory(item.id, 60), [item.id]);
  if (!data) return <Empty>вантажимо…</Empty>;
  const k = UNITS[item.unit]?.[1] ?? 1;
  const hist = data.history.filter((h) => h.book !== null).map((h) => ({ x: h.as_of, y: h.book / k }));
  const f = data.forecast;
  const now = Date.now();
  const ahead = f?.mean && data.book !== null ? f.mean.map((m, i) => ({
    x: new Date(now + (i + 1) * 86400_000).toISOString(),
    mean: (data.book - m) / k,
    low: (data.book - m - 1.2816 * Math.sqrt(Math.max(0, f.var[i]))) / k,
  })) : [];
  // Прогноз може піти нижче нуля — це й є «закінчиться»; вісь має його вмістити.
  const floor = Math.min(0, ...ahead.map((a) => a.low));
  return (
    <Line height={180} min={floor} format={(v) => v.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} series={[
      { name: `залишок, ${unitLabel(item.unit)}`, color: "#5AA9FF", points: hist },
      ...(ahead.length ? [
        { name: "прогноз, середнє", color: "#FE810B", points: [{ x: new Date(now).toISOString(), y: data.book / k }, ...ahead.map((a) => ({ x: a.x, y: a.mean }))] },
        { name: "прогноз, нижня межа 90 %", color: "#8B94A3", points: [{ x: new Date(now).toISOString(), y: data.book / k }, ...ahead.map((a) => ({ x: a.x, y: a.low }))] },
      ] : []),
    ]} />
  );
}

export function Stock() {
  const { data, error } = useData(() => api.stock(), []);
  const [selected, setSelected] = useState(null);
  const head = (
    <div className="head">
      <div>
        <h1>Залишки</h1>
        <p>розрахунок: остання інвентаризація + закупки − витрата за рецептами на кожне замовлення машини; прогноз — від продажів</p>
      </div>
      <div className="right">
        <button className="btn" onClick={() => go("stock/purchases/new")}>+ закупка</button>
        <button className="btn primary" onClick={() => go("stock/counts/new")}>+ інвентаризація</button>
      </div>
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;

  const cover = data.config.cover_days;
  const tracked = data.items.filter((i) => i.status === "ok" || i.status === "low");
  const item = data.items.find((i) => i.id === selected) ?? null;
  return (
    <>
      {head}
      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Запаси на складі" value={fmt.uah(data.totals.value)} note="розрахунковий залишок × середня ціна закупки" />
        <Kpi label={`Вистачить на ${cover} днів`} value={`${tracked.length - data.totals.low} / ${tracked.length}`}
             tone={data.totals.low ? "bad" : tracked.length ? "ok" : ""}
             note={data.totals.low ? `мало: ${data.items.filter((i) => i.status === "low").map((i) => i.name).join(", ")}` : "з імовірністю 90 %, матеріали з нормою витрати"} />
        <Kpi label="Остання інвентаризація" value={data.last_count ? fmt.dayFull(data.last_count.counted_at) : "не було"}
             note={data.last_count ? `${fmt.ago(data.last_count.counted_at)}; до неї — від закупок` : "залишок рахується від закупок"} />
        <Kpi label="Без норми" value={fmt.int(data.items.filter((i) => i.status === "nonorm").length)}
             note="немає ні в рецепті, ні щодобової витрати — прогнозу немає" />
      </div>

      {item && (
        <Card title={item.name} note="залишок за журналом і прогноз на 30 днів" style={{ marginBottom: 12 }}>
          <ItemChart item={item} />
        </Card>
      )}

      <Table
        onRow={(r) => setSelected(r.id === selected ? null : r.id)}
        columns={[
          {
            key: "name", title: "матеріал", render: (i) => (
              <span>{i.name}<small>{KIND[i.kind]}{i.pack_name ? ` · ${i.pack_name}` : ""}</small></span>
            ),
          },
          {
            key: "book", title: "залишок", num: true, render: (i) => (
              <span>{qty(i.unit, i.book)}{packs(i, i.book) && <small>{packs(i, i.book)}</small>}</span>
            ),
          },
          {
            key: "need", title: `витрата за ${cover} дн.`, num: true, render: (i) => (i.need?.mean
              ? <span>{qty(i.unit, i.need.mean)}<small>± {qty(i.unit, i.need.sd)}</small></span>
              : <span className="muted">—</span>),
          },
          {
            key: "cover", title: "вистачить на", num: true, render: (i) => (i.status === "ok" || i.status === "low"
              ? <span>{daysText(i.cover_days)}<small>з імовірністю 90 %: {daysText(i.cover_days_p90)}</small></span>
              : <span className="muted">—</span>),
          },
          {
            key: "value", title: "вартість", num: true, render: (i) => (i.value !== null
              ? <span>{fmt.uah(i.value)}<small>{i.unit_cost !== null ? `${i.unit_cost.toLocaleString("uk-UA", { maximumFractionDigits: 3 })} ₴/${i.unit === "pcs" ? "шт" : i.unit === "g" ? "г" : "мл"}` : ""}</small></span>
              : <span className="muted">—</span>),
          },
          { key: "status", title: "стан", render: (i) => { const [tone, text] = STATUS[i.status]; return <Badge tone={tone}>{text}</Badge>; } },
          { key: "counted_at", title: "інвентаризація", render: (i) => (i.counted_at ? fmt.dayFull(i.counted_at) : <span className="muted">від закупок</span>) },
        ]}
        rows={data.items}
        empty="матеріалів немає — їх додають на вкладці «матеріали й рецепти»"
        foot={<span className="muted small">рядок — графік залишку й прогнозу; «невідомо» — ні закупок, ні інвентаризації</span>}
      />
    </>
  );
}
