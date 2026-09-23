// Дашборд статистики: гроші, бонуси, монети, маркет (docs/admin_panel.md).
// Фільтр по датах, типово — 30 діб, розріз у добу.
import { useState } from "react";
import { api } from "../api.js";
import { Columns, Donut, Line } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

// Кольори точок — у порядку макета (кадр «Дохід»): помаранчевий, синій,
// фіолетовий і далі. Решта відтінків підписана там, де вживається.
const COLORS = ["#FE810B", "#5AA9FF", "#B07CFF", "#3FBF6F", "#FFB020", "#FF2D6F"];
const CAMERA = { approach: "#FE810B", payment: "#5AA9FF", pour: "#3FBF6F" };
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

export function Stats() {
  const [range, setRange] = useState({});
  const { data, error, loading } = useData(() => api.stats(range), [range.from, range.to]);

  if (error) return <Empty>не вдалось порахувати: {error.message}</Empty>;
  if (!data) return <Empty>{loading ? "рахуємо…" : "порожньо"}</Empty>;

  const { totals } = data;
  const days = Math.max(1, Math.round((+new Date(data.to) - +new Date(data.from)) / DAY));
  // Виручка по точках: кожна точка — свій ряд, як у макеті.
  const points = [...new Set(data.revenue.map((r) => r.point_id))];
  const revenueSeries = points.map((id, i) => ({
    name: data.revenue.find((r) => r.point_id === id)?.point_name ?? id,
    color: COLORS[i % COLORS.length],
    points: data.revenue.filter((r) => r.point_id === id).map((r) => ({ x: r.day, y: r.sum_uah })),
  }));

  // Покупки — ті самі чеки, що й дохід, тільки кількістю (кадр «Покупки»).
  const purchaseSeries = points.map((id, i) => ({
    name: data.revenue.find((r) => r.point_id === id)?.point_name ?? id,
    color: COLORS[i % COLORS.length],
    points: data.revenue.filter((r) => r.point_id === id).map((r) => ({ x: r.day, y: r.receipts })),
  }));

  // Камери ще не стоять — ряд лишається порожнім, і графік сам скаже це
  // словами замість порожньої сітки.
  const cameraSeries = [...new Set((data.events ?? []).map((e) => e.kind))].map((kind, i) => ({
    name: kind,
    color: CAMERA[kind] ?? COLORS[i % COLORS.length],
    points: data.events.filter((e) => e.kind === kind).map((e) => ({ x: e.day, y: e.n })),
  }));

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

      {/* Порядок і розбиття на ряди по три — як у макеті адмінки. */}
      <div className="grid k3">
        <Card title="Дохід" note="за добу, ₴">
          <Line series={revenueSeries} area format={(v) => `${Math.round(v)}`} />
        </Card>
        <Card title="Покупки" note="за добу">
          <Line series={purchaseSeries} area />
        </Card>
        <Card title="Події з камер" note="камер поки немає">
          <Line series={cameraSeries} area />
        </Card>
      </div>

      <div className="grid k3" style={{ marginTop: 12 }}>
        <Card title="Дохід за годиною дня" note="₴, середнє">
          <Columns items={hours(data.by_hour ?? [], days)} format={(v) => fmt.uah(v)} every={3} />
        </Card>
        <Card title="Дохід за днями тижня" note="₴, середнє">
          <Columns items={weekdays(data.by_weekday ?? [], data.from, data.to)} format={(v) => fmt.uah(v)} />
        </Card>
        {/* Третьої частки — «ігнорують бонуси» з макета — у нас немає: чек
            без бонусу не відрізнити від чека, за яким по бонус не прийшли. */}
        <Card title="Взаємодія з бонусами" note="частка чеків">
          <Donut
            items={[
              { label: "Бонус забрали", value: data.bonus_split?.redeemed ?? 0 },
              { label: "Бонус лежить", value: data.bonus_split?.waiting ?? 0 },
            ]}
            colors={["#FE810B", "#8B94A3"]}
          />
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

      <div className="grid k2" style={{ marginTop: 12 }}>
        {/* У макеті другий ряд — «прострочено», але токен бонусу більше не
            згоряє (23.09.2026). Чесна пара до забраних — ті, що лежать. */}
        <Card title="Редім бонусів" note="за добу">
          <Line area series={[
            line(data.bonuses, "redeemed", "забрали", "#5AA9FF"),
            lineOf(data.bonuses, (r) => (r.granted ?? 0) - (r.redeemed ?? 0), "не забрали", "#FF4D5E"),
          ]} />
        </Card>
        <Card title="P2P оборот" note="жовтих монет за добу">
          <Line area series={p2pSeries} />
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
