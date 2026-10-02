// Аналітика застосунку гравця (власник, 02.10.2026): власний збір подій —
// кожна навігація й кожен запит до api (api/src/analytics.js), відра рахує
// scheduler раз на десять хвилин (jobs/analytics.js).
//
// Розділи — питаннями, на які відповідає дашборд:
//   Аудиторія   — скільки людей, чи повертаються, як довго сидять;
//   Навігація   — куди ходять, звідки заходять, де кидають;
//   Дії й воронки — що роблять і на якому кроці відвалюються;
//   Час і пристрої — коли й з чого;
//   Технічне    — які запити повільні чи падають, як їх бачить гравець.
import { useState } from "react";
import { api } from "../api.js";
import { Bars, Columns, Donut, Line } from "../charts.jsx";
import { Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const WINDOWS = [[1, "доба"], [7, "тиждень"], [30, "місяць"]];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const PLATFORM = { ios: "iPhone / iPad", android: "Android", desktop: "компʼютер", other: "інше" };

// Екрани застосунку людською мовою (ключі — client/src/screens/index.js).
const SCREEN = {
  start: "Старт (гість)", emailLogin: "Вхід поштою", onboarding: "Реєстрація", problem: "Скарга",
  plant: "Кавенятко", shop: "Магазин", stock: "Склад", wallet: "Гаманець", history: "Покупки",
  catalog: "Весь одяг", itemCard: "Річ", shopItem: "Скринька", shopProduct: "Товар магазину",
  planting: "Посадка", wardrobe: "Гардероб", chat: "Чат", plantName: "Імʼя кавенятка",
  sellItem: "Продаж речі", sellPlant: "Продаж кавенятка", listings: "Мої лоти", plantMarket: "Ринок кавенят",
  transfer: "Переказ", coinPacks: "Набори монет", paymentResult: "Результат оплати", transactions: "Історія транзакцій",
  checkout: "Оформлення доставки", sizeChart: "Таблиця розмірів", orders: "Мої замовлення", order: "Замовлення",
  quizProfile: "Анкета", quizDrink: "Квіз про напій", repost: "Пост", repostLanding: "Сторінка посту",
  profile: "Профіль", nicknameChange: "Зміна нікнейма", deleteAccount: "Видалення акаунта",
  terms: "Умови", privacy: "Приватність",
};
const screenName = (k) => SCREEN[k] ?? k;
const transitionName = (k) => k.split("→").map(screenName).join(" → ");

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const duration = (s) => {
  const v = Math.round(Number(s) || 0);
  if (v < 60) return `${v} с`;
  if (v < 3600) return `${Math.floor(v / 60)} хв ${v % 60 ? `${v % 60} с` : ""}`.trim();
  return `${Math.floor(v / 3600)} год ${Math.round((v % 3600) / 60)} хв`;
};
const ms = (v) => `${Math.round(Number(v) || 0)} мс`;

// { розріз: значення } → відсортовані рядки для Bars.
const top = (obj = {}, n = 12, label = (k) => k) =>
  Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ label: label(k), value: v, key: k }));

// Усі дні проміжку, і порожні теж: день без подій — це нуль на графіку, а
// не дірка, яку лінія перестрибне (і вісь тоді йде по датах, а не годинах).
const dayList = (n) => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
};
const valueOn = (daily, metric, day, dim = "") => daily.find((r) => r.metric === metric && r.dim === dim && r.day === day)?.value ?? 0;

// Денні відра → ряд графіка.
const series = (daily, days, metric, name, color, dim = "") => ({
  name, color,
  points: days.map((day) => ({ x: `${day}T12:00:00`, y: valueOn(daily, metric, day, dim) })),
});

export function Analytics() {
  const [days, setDays] = useState(7);
  const { data, error, loading } = useData(() => api.analytics(days), [days]);

  const head = (
    <div className="head">
      <div>
        <h1>Аналітика застосунку</h1>
        <p>
          Навігація й запити гравців{data?.computed_at ? ` · пораховано ${fmt.ago(data.computed_at)}` : ""} · оновлюється раз на 10 хвилин
        </p>
      </div>
      <div className="right">
        <div className="chips">
          {WINDOWS.map(([d, label]) => (
            <button key={d} className={`pill${days === d ? " on" : ""}`} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );

  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>{loading ? "рахуємо…" : "порожньо"}</Empty></>;
  const w = data.window;
  const one = (m) => w[m]?.[""] ?? 0;
  if (!Object.keys(w).length) return <>{head}<Empty>подій ще немає — перші зрізи з’являться за десять хвилин після перших відвідин</Empty></>;

  const users = one("users"), guests = one("guests"), people = users + guests;
  const sessions = one("sessions");
  const userDays = one("user_days");

  // Воронки: «Назва|крок|підпис» → { назва: [{label, value}] } по порядку кроків.
  const funnels = {};
  for (const [dim, value] of Object.entries(w.funnel ?? {})) {
    const [name, step, label] = dim.split("|");
    (funnels[name] ??= [])[Number(step)] = { label, value };
  }

  const actions = Object.keys(w.action_count ?? {})
    .map((label) => ({ label, count: w.action_count[label], people: w.action_people?.[label] ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const routes = Object.keys(w.route_requests ?? {}).map((route) => ({
    route,
    n: w.route_requests[route],
    p50: w.route_p50_ms?.[route] ?? 0,
    p95: w.route_p95_ms?.[route] ?? 0,
    e4: w.route_4xx?.[route] ?? 0,
    e5: w.route_5xx?.[route] ?? 0,
  }));
  const byCount = [...routes].sort((a, b) => b.n - a.n).slice(0, 20);
  // Повільні — лише серед маршрутів, що викликались хоч кілька разів:
  // один холодний запит не робить маршрут «повільним».
  const slow = routes.filter((r) => r.n >= 5).sort((a, b) => b.p95 - a.p95).slice(0, 10);
  const routeCols = [
    { key: "route", title: "Запит", render: (r) => <code style={{ fontSize: 11 }}>{r.route}</code> },
    { key: "n", title: "Разів", num: true, render: (r) => fmt.int(r.n) },
    { key: "p50", title: "p50", num: true, render: (r) => ms(r.p50) },
    { key: "p95", title: "p95", num: true, render: (r) => ms(r.p95) },
    { key: "e4", title: "4xx", num: true, render: (r) => (r.e4 ? `${fmt.int(r.e4)} · ${pct(r.e4, r.n)}` : "—") },
    { key: "e5", title: "5xx", num: true, render: (r) => (r.e5 ? <b style={{ color: "#FF6B7A" }}>{fmt.int(r.e5)}</b> : "—") },
  ];

  const daily = data.daily;
  const trendDays = dayList(Math.max(days, 14));
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), value: Math.round((w.hour_people?.[h] ?? 0) * 10) / 10 }));
  const weekdays = WEEKDAYS.map((label, i) => ({ label, value: Math.round((w.weekday_people?.[i + 1] ?? 0) * 10) / 10 }));

  return (
    <>
      {head}

      <h2 className="section-title">Аудиторія</h2>
      <div className="grid k4">
        <Kpi label="Активні гравці" value={fmt.int(users)} note={`увійшли в акаунт · ще ${fmt.int(guests)} ${fmt.plural(guests, "гість", "гості", "гостей")} без входу`} />
        <Kpi label="Нові акаунти" value={fmt.int(one("signups"))} note={`повернулись ті, хто з нами давніше: ${fmt.int(one("returning"))}`} />
        <Kpi label="Сесії" value={fmt.int(sessions)} note={`медіана ${duration(one("session_median_s"))}, у 10% — довше ${duration(one("session_p90_s"))}`} />
        <Kpi label="Утримання" value={`${pct(one("retention_d1"), one("retention_d1_base"))} / ${pct(one("retention_d7"), one("retention_d7_base"))}`}
             note={`повернулись на 2-й / 8-й день · реєстрації за 30 діб (${fmt.int(one("retention_d1_base"))} / ${fmt.int(one("retention_d7_base"))})`} />
      </div>
      <div className="grid k4" style={{ marginTop: 12 }}>
        <Kpi label="Екранів за сесію" value={(Math.round(one("screens_per_session") * 10) / 10).toLocaleString("uk-UA")}
             note={`сесій з одним екраном: ${pct(one("single_screen_sessions"), sessions)}`} />
        <Kpi label="Сесій на гравця" value={users ? (Math.round((sessions / Math.max(1, people)) * 10) / 10).toLocaleString("uk-UA") : "—"} note="разом із гостями" />
        <Kpi label="Днів з нами" value={users ? (Math.round((userDays / users) * 10) / 10).toLocaleString("uk-UA") : "—"}
             note={days > 1 ? `з ${days} · липкість ${pct(userDays, users * days)} (у середньому щодня заходить така частка)` : "активних днів на гравця"} />
        <Kpi label="Переглядів екранів" value={fmt.int(one("views"))} note={`${fmt.int(one("requests"))} запитів до api`} />
      </div>

      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Активність по днях" note={`останні ${Math.max(days, 14)} днів`}>
          <Line series={[
            series(daily, trendDays, "users", "гравці", "#FE810B"),
            series(daily, trendDays, "guests", "гості", "#8B94A3"),
            series(daily, trendDays, "sessions", "сесії", "#5AA9FF"),
          ]} />
        </Card>
        <Card title="Нові акаунти по днях" note={`останні ${Math.max(days, 14)} днів`}>
          <Columns items={trendDays.map((day) => ({ label: fmt.day(`${day}T12:00:00`), value: valueOn(daily, "signups", day) }))} every={days > 14 ? 5 : 2} />
        </Card>
      </div>

      <h2 className="section-title">Навігація</h2>
      <div className="grid k3">
        <Card title="Екрани за переглядами">
          <Bars items={top(w.screen_views, 14, screenName)} label={130} />
        </Card>
        <Card title="Охоплення екранів" note="частка людей, що відкрили хоч раз">
          <Bars items={top(w.screen_people, 14, screenName).map((i) => ({ ...i, value: people ? Math.round((i.value / people) * 100) : 0 }))}
                max={100} format={(v) => `${v}%`} label={130} />
        </Card>
        <Card title="Переходи між екранами" note="найчастіші">
          <Bars items={top(w.transition, 14, transitionName)} label={190} />
        </Card>
      </div>
      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Звідки починають" note="перший екран сесії">
          <Bars items={top(w.entry, 8, screenName)} label={150} format={(v) => pct(v, sessions)} />
        </Card>
        <Card title="Де закінчують" note="останній екран сесії">
          <Bars items={top(w.exit, 8, screenName)} label={150} format={(v) => pct(v, sessions)} />
        </Card>
      </div>

      <h2 className="section-title">Дії й воронки</h2>
      <div className="grid k2">
        <Card title="Що роблять" note="успішні дії">
          <Table rows={actions} empty="дій за цей період немає" columns={[
            { key: "label", title: "Дія" },
            { key: "count", title: "Разів", num: true, render: (r) => fmt.int(r.count) },
            { key: "people", title: "Людей", num: true, render: (r) => fmt.int(r.people) },
            { key: "per", title: "На людину", num: true, render: (r) => (r.people ? (Math.round((r.count / r.people) * 10) / 10).toLocaleString("uk-UA") : "—") },
            { key: "share", title: "Частка активних", num: true, render: (r) => pct(r.people, people) },
          ]} />
        </Card>
        <Card title="Воронки" note="скільки людей пройшли кроки по порядку">
          <div className="stack" style={{ gap: 14 }}>
            {Object.entries(funnels).map(([name, steps]) => {
              const first = steps[0]?.value ?? 0;
              return (
                <div key={name}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{name}</div>
                  <Bars items={steps.filter(Boolean).map((s) => ({ label: s.label, value: s.value }))} max={Math.max(1, first)} label={130}
                        format={(v) => `${fmt.int(v)} · ${pct(v, first)}`} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <h2 className="section-title">Час і пристрої</h2>
      <div className="grid k3">
        <Card title="Година доби" note="активних людей, у середньому">
          <Columns items={hours} every={3} format={(v) => v.toLocaleString("uk-UA")} />
        </Card>
        <Card title="День тижня" note="активних людей, у середньому">
          <Columns items={weekdays} format={(v) => v.toLocaleString("uk-UA")} />
        </Card>
        <Card title="Пристрої" note="людей">
          <Donut items={top(w.platform_people, 4, (k) => PLATFORM[k] ?? k)} colors={["#FE810B", "#3FBF6F", "#5AA9FF", "#8B94A3"]} />
        </Card>
      </div>

      <h2 className="section-title">Технічне</h2>
      <div className="grid k4">
        <Kpi label="Запитів до api" value={fmt.int(one("api_requests"))} note="від застосунку гравця" />
        <Kpi label="Помилки сервера" value={pct(one("api_5xx"), one("api_requests"))} tone={one("api_5xx") ? "bad" : undefined}
             note={`${fmt.int(one("api_5xx"))} відповідей 5xx`} />
        <Kpi label="Відмови 4xx" value={pct(one("api_4xx"), one("api_requests"))} note="401 перед оновленням токена — норма" />
        <Kpi label="Швидкість" value={ms(one("api_p95_ms"))} note={`p95 · медіана ${ms(one("api_p50_ms"))}`} />
      </div>
      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Найчастіші запити">
          <Table rows={byCount} columns={routeCols} scroll />
        </Card>
        <Card title="Найповільніші" note="p95, від 5 викликів">
          <Table rows={slow} columns={routeCols} scroll />
        </Card>
      </div>
    </>
  );
}
