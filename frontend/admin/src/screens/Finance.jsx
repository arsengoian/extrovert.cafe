// «Фінанси» (огляд): виручка по точках і добах, за годиною дня й днем
// тижня (до 18.10.2026 — на «Статистиці»), собівартість і валовий прибуток,
// закупки й інші витрати, вартість запасів на складі й окупність вкладеного
// (docs/stock.md). Доба — київська. Віддає api/src/routes/admin-sales.js
// (/admin/finance).
import { useState } from "react";
import { api } from "../api.js";
import { Columns, Line } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

// Кольори точок — у порядку макета (кадр «Дохід»): помаранчевий, синій,
// фіолетовий і далі.
const COLORS = ["#FE810B", "#5AA9FF", "#B07CFF", "#3FBF6F", "#FFB020", "#FF2D6F"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const DAY = 86400_000;

// Година дня — усі 24, навіть порожні: у графіку «коли купують» дірка о
// третій ночі така сама відповідь, як стовпчик о восьмій ранку.
//
// Значення — середнє за добу (у макеті «₴, середнє»). Усередині цього
// графіка це та сама картинка, що й сума: годин у добі порівну, тож
// ділення на кількість діб лише міняє підпис осі. Сенс з'являється при
// перемиканні проміжку: 7 днів і рік у середньому порівнюються, у сумі ні.
const hours = (rows, days) => Array.from({ length: 24 }, (_, h) => ({
  label: String(h).padStart(2, "0"),
  value: Math.round((rows.find((r) => r.hour === h)?.sum_uah ?? 0) / Math.max(1, days)),
}));

// А ось тут дільник свій на кожен стовпчик, і це вже міняє саму картинку:
// за 30 діб понеділків чотири або п'ять, тож сума занизила б рідший день.
const weekdays = (rows, from, to) => WEEKDAYS.map((label, i) => {
  const isodow = i + 1;
  let n = 0;
  for (let t = +new Date(from); t <= +new Date(to); t += DAY) {
    if (((new Date(t).getDay() + 6) % 7) + 1 === isodow) n++;
  }
  return { label, value: Math.round((rows.find((r) => r.weekday === isodow)?.sum_uah ?? 0) / Math.max(1, n)) };
});

export function Finance() {
  const [range, setRange] = useState({});
  const { data, error, loading } = useData(() => api.finance(range), [range.from, range.to]);

  if (error) return <Empty>не вдалось порахувати: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? "рахуємо…" : "порожньо"}</Empty>;

  const { totals, ever } = data;
  const days = Math.max(1, Math.round((+new Date(data.to) - +new Date(data.from)) / DAY));
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");
  // Дохід, собівартість і валовий прибуток по добах — усі точки разом.
  const byDay = new Map();
  const at = (day) => byDay.get(day) ?? byDay.set(day, { revenue: 0, cogs: totals.daily_cost ?? 0 }).get(day);
  for (const r of data.revenue) at(r.day).revenue += r.sum_uah;
  for (const c of data.cogs ?? []) at(c.day).cogs += c.cogs;
  const pnlDays = [...byDay.keys()].sort();
  const pnl = (key, name, color, value) => ({
    name, color, points: pnlDays.map((d) => ({ x: `${d}T12:00:00`, y: value ? value(byDay.get(d)) : byDay.get(d)[key] })),
  });
  const spendSeries = (key, name, color) => ({ name, color, points: (data.spend ?? []).map((r) => ({ x: `${r.day}T12:00:00`, y: r[key] })) });
  // Окупність: що вже повернуло вкладене в CAPEX — валовий прибуток мінус OPEX
  // з самого початку продажів.
  const returned = ever ? ever.revenue - ever.cogs - ever.opex : 0;
  // Виручка по точках: кожна точка — свій ряд, як у макеті.
  const points = [...new Set(data.revenue.map((r) => r.point_id))];
  const revenueSeries = points.map((id, i) => ({
    name: data.revenue.find((r) => r.point_id === id)?.point_name ?? id,
    color: COLORS[i % COLORS.length],
    points: data.revenue.filter((r) => r.point_id === id).map((r) => ({ x: `${r.day}T12:00:00`, y: r.sum_uah })),
  }));

  return (
    <>
      <div className="head">
        <div>
          <h1>Фінанси</h1>
          <p>Виручка за київські доби: {fmt.dayFull(data.from)} — {fmt.dayFull(data.to)}, без тестових чеків і власника</p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Виручка" value={fmt.uah(totals.revenue)}
             note={`${fmt.int(totals.receipts)} чеків, середній ${totals.receipts ? fmt.uah(totals.revenue / totals.receipts) : "—"}, за добу ${fmt.uah(totals.revenue / days)}`} />
        <Kpi label="Собівартість" value={fmt.uah(totals.cogs)} note={`${pct(totals.cogs, totals.revenue)} виручки; матеріали за рецептами × середня ціна закупки`} />
        <Kpi label="Валовий прибуток" value={fmt.uah(totals.gross)} tone={totals.gross < 0 ? "bad" : ""} note={`маржа ${pct(totals.gross, totals.revenue)}`} />
        <Kpi label="Запаси на складі" value={totals.stock_value === null ? "—" : fmt.uah(totals.stock_value)} note="на кінець періоду, за журналом залишків" />
      </div>
      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Закупки матеріалів" value={fmt.uah(totals.material)} note="за період, за днем отримання" />
        <Kpi label="OPEX" value={fmt.uah(totals.opex)} note="поточні витрати, крім матеріалів" />
        <Kpi label="CAPEX" value={fmt.uah(totals.capex)} note="обладнання й запуск, за період" />
        <Kpi label="Окупність" value={ever?.capex ? pct(returned, ever.capex) : "—"} tone={returned >= (ever?.capex ?? Infinity) ? "ok" : ""}
             note={ever?.capex ? `повернуто ${fmt.uah(returned)} з ${fmt.uah(ever.capex)} CAPEX — валовий прибуток мінус OPEX від початку продажів` : "CAPEX не внесено"} />
      </div>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="Дохід" note="за київську добу, ₴, по точках">
          <Line series={revenueSeries} area format={(v) => `${Math.round(v)}`} />
        </Card>
        <Card title="Дохід, собівартість і валовий прибуток" note="за добу, ₴, усі точки">
          <Line format={(v) => `${Math.round(v)}`} min={Math.min(0, ...pnlDays.map((d) => byDay.get(d).revenue - byDay.get(d).cogs))} series={[
            pnl("revenue", "дохід", "#FE810B"),
            pnl("cogs", "собівартість", "#FF4D5E"),
            pnl(null, "валовий прибуток", "#3FBF6F", (r) => r.revenue - r.cogs),
          ]} />
        </Card>
      </div>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="Вартість запасів" note="на кінець доби, ₴">
          <Line area format={(v) => fmt.uah(v)} series={[{ name: "запаси", color: "#5AA9FF", points: (data.stock_value ?? []).map((r) => ({ x: `${r.day}T12:00:00`, y: r.value })) }]} />
        </Card>
        <Card title="Закупки й витрати" note="за днем отримання, ₴">
          <Line format={(v) => `${Math.round(v)}`} series={[
            spendSeries("material", "матеріали", "#5AA9FF"),
            spendSeries("opex", "OPEX", "#FFB020"),
            spendSeries("capex", "CAPEX", "#B07CFF"),
          ]} />
        </Card>
      </div>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="Дохід за годиною дня" note="₴, середнє за добу">
          <Columns items={hours(data.by_hour ?? [], days)} format={(v) => fmt.uah(v)} every={3} />
        </Card>
        <Card title="Дохід за днями тижня" note="₴, середнє">
          <Columns items={weekdays(data.by_weekday ?? [], data.from, data.to)} format={(v) => fmt.uah(v)} />
        </Card>
      </div>

      <Table
        columns={[
          { key: "day", title: "доба", render: (r) => fmt.dayFull(`${r.day}T12:00:00`) },
          { key: "point_name", title: "точка" },
          { key: "receipts", title: "чеків", num: true, render: (r) => fmt.int(r.receipts) },
          { key: "sum_uah", title: "виручка", num: true, render: (r) => fmt.uah(r.sum_uah) },
        ]}
        rows={[...data.revenue].reverse()}
        empty="чеків за цей період немає"
      />
    </>
  );
}
