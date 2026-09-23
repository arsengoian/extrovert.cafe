// Дашборд статистики: гроші, бонуси, монети, маркет (docs/admin_panel.md).
// Фільтр по датах, типово — 30 діб, розріз у добу.
import { useState } from "react";
import { api } from "../api.js";
import { Bars, Line } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const COLORS = ["#FE810B", "#FF2D6F", "#3FBF6F", "#4FA8FF", "#FFB020", "#9B7BFF"];
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

// Година дня — усі 24, навіть порожні: у графіку «коли купують» дірка о
// третій ночі така сама відповідь, як стовпчик о восьмій ранку.
const hours = (rows) => Array.from({ length: 24 }, (_, h) => ({
  label: `${String(h).padStart(2, "0")}:00`,
  value: Math.round(rows.find((r) => r.hour === h)?.sum_uah ?? 0),
}));
const weekdays = (rows) => WEEKDAYS.map((label, i) => ({
  label,
  value: Math.round(rows.find((r) => r.weekday === i + 1)?.sum_uah ?? 0),
}));

// Ряди для лінії: із плоского списку {day, ...} у точки одного кольору.
const line = (rows, key, name, color) => ({
  name,
  color,
  points: rows.map((r) => ({ x: r.day, y: Number(r[key] ?? 0) })),
});

export function Stats() {
  const [range, setRange] = useState({});
  const { data, error, loading } = useData(() => api.stats(range), [range.from, range.to]);

  if (error) return <Empty>не вдалось порахувати: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? "рахуємо…" : "порожньо"}</Empty>;

  const { totals } = data;
  // Виручка по точках: кожна точка — свій ряд, як у макеті.
  const points = [...new Set(data.revenue.map((r) => r.point_id))];
  const revenueSeries = points.map((id, i) => ({
    name: data.revenue.find((r) => r.point_id === id)?.point_name ?? id,
    color: COLORS[i % COLORS.length],
    points: data.revenue.filter((r) => r.point_id === id).map((r) => ({ x: r.day, y: r.sum_uah })),
  }));

  return (
    <>
      <div className="head">
        <div>
          <h1>Дашборд статистики</h1>
          <p>
            Розріз у добу · {fmt.dayFull(data.from)} — {fmt.dayFull(data.to)}
            {data.cached_at ? ` · кеш оновлено о ${fmt.time(data.cached_at)}` : ""}
          </p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Виручка" value={fmt.uah(totals.revenue)} note={`${fmt.int(totals.receipts)} чеків`} />
        <Kpi label="Бонуси зараховано" value={fmt.int(totals.redeemed)} note="чеків, за якими забрали бонус" />
        <Kpi label="Нових користувачів" value={fmt.int(totals.new_users)} note={`активних за період: ${fmt.int(totals.active_users)}`} />
        <Kpi label="Обіг ринку" value={fmt.int(totals.market_gross)} note="монет у зведених угодах" />
      </div>

      <div className="wrap-cols">
        <Card title="Виручка за точками" note="гривні на добу">
          <Line series={revenueSeries} format={(v) => `${Math.round(v)}`} />
        </Card>
        <Card title="Бонуси" note="видано й зараховано">
          <Line series={[
            line(data.bonuses, "granted", "видано", COLORS[0]),
            line(data.bonuses, "redeemed", "зараховано", COLORS[2]),
          ]} />
        </Card>
      </div>

      <div className="wrap-cols" style={{ marginTop: 12 }}>
        <Card title="Монети й боби" note="зароблено й витрачено за добу">
          <Line series={[
            line(data.coins, "yellow_in", "жовті +", "#FFB020"),
            line(data.coins, "yellow_out", "жовті −", "#FE810B"),
            line(data.coins, "silver_in", "срібні +", "#8B94A3"),
            line(data.coins, "beans_out", "боби −", "#3FBF6F"),
          ]} />
        </Card>
        <Card title="Ринок" note="угоди за добу">
          <Line series={[
            line(data.market.filter((m) => m.currency === "yellow"), "gross", "жовті монети", COLORS[0]),
            line(data.market.filter((m) => m.currency === "silver"), "gross", "срібні монети", COLORS[3]),
          ]} />
        </Card>
      </div>

      <div className="wrap-cols" style={{ marginTop: 12 }}>
        <Card title="Дохід за годиною дня" note="гривні за весь період">
          <Bars items={hours(data.by_hour ?? [])} format={(v) => fmt.uah(v)} />
        </Card>
        <Card title="Дохід за днями тижня" note="гривні за весь період">
          <Bars items={weekdays(data.by_weekday ?? [])} format={(v) => fmt.uah(v)} color="#FF2D6F" />
        </Card>
      </div>

      <div className="wrap-cols" style={{ marginTop: 12 }}>
        <Card title="Взаємодія з бонусами" note="за чеками періоду">
          <Bars
            items={[
              { label: "бонус забрали", value: data.bonus_split?.redeemed ?? 0 },
              { label: "бонус лежить", value: data.bonus_split?.waiting ?? 0 },
            ]}
            color="#3FBF6F"
          />
        </Card>
        <Card title="Події з камер" note="камер поки немає">
          {data.events?.length
            ? <Bars items={data.events.map((e) => ({ label: e.kind, value: e.n }))} color="#4FA8FF" />
            : <Empty>камери ще не встановлені — подій немає</Empty>}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Table
          columns={[
            { key: "day", title: "доба", render: (r) => fmt.dayFull(r.day) },
            { key: "point_name", title: "точка", render: (r) => r.point_name ?? r.point_id },
            { key: "receipts", title: "чеків", num: true, render: (r) => fmt.int(r.receipts) },
            { key: "sum_uah", title: "виручка", num: true, render: (r) => fmt.uah(r.sum_uah) },
          ]}
          rows={[...data.revenue].reverse()}
          empty="чеків за цей період немає"
        />
      </div>
    </>
  );
}
