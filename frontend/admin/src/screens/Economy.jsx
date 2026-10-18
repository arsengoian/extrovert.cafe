// «Гравці» → економіка гри: бонуси за чеки, монети, зерна, ринок
// (docs/admin_panel.md). До 18.10.2026 — «Статистика»; виручка звідти
// переїхала у «Фінанси», покупки й події камери — у «Продажі», нові й
// активні гравці — у «Застосунок» (там вони рахуються з подій, а не з
// last_seen). Фільтр по датах, типово — 30 діб, розріз у київську добу.
import { useState } from "react";
import { api } from "../api.js";
import { Donut, Line } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, fmt, useData } from "../ui.jsx";

// Ряди для лінії: із плоского списку {day, ...} у точки одного кольору.
const line = (rows, key, name, color) => ({
  name,
  color,
  points: rows.map((r) => ({ x: r.day, y: Number(r[key] ?? 0) })),
});

// Те саме, але значення рахує функція: «не забрано» — це різниця двох
// колонок, а не колонка.
const lineOf = (rows, value, name, color) => ({
  name,
  color,
  points: rows.map((r) => ({ x: r.day, y: Math.max(0, Number(value(r))) })),
});

// Сума по добі для рядів, що приходять розбитими (ринок — ще й за валютою).
const byDay = (rows, name, color) => {
  const sum = new Map();
  for (const r of rows) sum.set(r.day, (sum.get(r.day) ?? 0) + Number(r.gross ?? r.n ?? 0));
  return { name, color, points: [...sum].map(([x, y]) => ({ x, y })) };
};

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");

export function Economy() {
  const [range, setRange] = useState({});
  const { data, error, loading } = useData(() => api.stats(range), [range.from, range.to]);

  if (error) return <Empty>не вдалось порахувати: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? "рахуємо…" : "порожньо"}</Empty>;

  const { totals } = data;
  const split = data.bonus_split ?? { redeemed: 0, waiting: 0 };
  const granted = split.redeemed + split.waiting;

  // P2P: кавенятка проти одягу. Беремо лише жовті угоди — бобові в ту саму
  // суму не складаються, а два масштаби на одній осі збрехали б.
  const yellow = (data.market ?? []).filter((m) => m.currency === "yellow");
  const p2pSeries = [
    byDay(yellow.filter((m) => m.kind === "plant"), "кавенятка", "#B07CFF"),
    byDay(yellow.filter((m) => m.kind === "item"), "одяг", "#FE810B"),
  ];

  return (
    <>
      <div className="head">
        <div>
          <h1>Економіка гри</h1>
          <p>
            Розріз у добу: {fmt.dayFull(data.from)} — {fmt.dayFull(data.to)}
            {data.cached_at ? `, кеш оновлено о ${fmt.time(data.cached_at)}` : ""}
          </p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      {/* Бонуси — за датою чека і тут, і на графіках нижче: досі KPI рахував
          за датою, коли бонус забрали, і не сходився з діаграмою поруч. */}
      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Бонусів забрали" value={fmt.int(split.redeemed)} note={`${pct(split.redeemed, granted)} бонусів за чеки періоду`} />
        <Kpi label="Бонусів лежить" value={fmt.int(split.waiting)} note="чеки періоду, за якими по бонус не прийшли" />
        <Kpi label="Обіг ринку" value={fmt.int(totals.market_gross)}
             note={`монет у ${fmt.int(totals.market_trades)} ${fmt.plural(totals.market_trades, "угоді", "угодах", "угодах")}, усі валюти; комісія ${fmt.int(totals.market_commission)}`} />
      </div>

      <div className="grid k3">
        {/* Третьої частки — «ігнорують бонуси» з макета — у нас немає: чек
            без бонусу не відрізнити від чека, за яким по бонус не прийшли. */}
        <Card title="Взаємодія з бонусами" note="частка чеків">
          <Donut
            items={[
              { label: "Бонус забрали", value: split.redeemed },
              { label: "Бонус лежить", value: split.waiting },
            ]}
            colors={["#FE810B", "#8B94A3"]}
          />
        </Card>
        {/* У макеті другий ряд — «прострочено», але токен бонусу більше не
            згоряє (23.09.2026). Чесна пара до забраних — ті, що лежать. */}
        <Card title="Редім бонусів" note="за добою чека">
          <Line area series={[
            line(data.bonuses, "redeemed", "забрали", "#5AA9FF"),
            lineOf(data.bonuses, (r) => (r.granted ?? 0) - (r.redeemed ?? 0), "не забрали", "#FF4D5E"),
          ]} />
        </Card>
        <Card title="P2P оборот" note="жовтих монет за добу">
          <Line area series={p2pSeries} />
        </Card>
      </div>

      <div className="grid k3" style={{ marginTop: 12 }}>
        <Card title="Нарахування монет" note="за добу">
          <Line area series={[
            line(data.coins, "silver_in", "срібні +", "#9AA6B8"),
            line(data.coins, "yellow_in", "золоті +", "#FFB020"),
          ]} />
        </Card>
        <Card title="Витрати монет" note="за добу">
          <Line area series={[
            line(data.coins, "silver_out", "срібні −", "#9AA6B8"),
            line(data.coins, "yellow_out", "золоті −", "#FF4D5E"),
          ]} />
        </Card>
        {/* Зерна — чисті лінії: тут важить не обсяг, а чи встигають їх
            витрачати (кадр «Кавові зерна»). */}
        <Card title="Кавові зерна" note="отримання та витрати">
          <Line series={[
            line(data.coins, "beans_in", "отримано", "#3FBF6F"),
            line(data.coins, "beans_out", "витрачено", "#FF4D5E"),
          ]} />
        </Card>
      </div>
    </>
  );
}
