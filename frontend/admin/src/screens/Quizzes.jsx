// Дашборд опитувань: анкета профілю й відгуки про напої
// (docs/admin_panel.md). Бонусні копії напою рахуються разом з основними —
// у них той самий system_code.
import { useState } from "react";
import { api } from "../api.js";
import { Bars } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, fmt, useData } from "../ui.jsx";

const Questions = ({ block, color }) => (
  block.questions.length === 0
    ? <Empty>відповідей за період немає</Empty>
    : block.questions.map((q) => (
      <div key={q.question} style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 7 }}>
          <b style={{ fontSize: 12 }}>{q.question}</b>
          <span className="muted" style={{ fontSize: 10.5 }}>{fmt.int(q.total)} відповідей</span>
        </div>
        <Bars items={q.options.map((o) => ({ label: o.value, value: o.count }))} color={color} />
      </div>
    ))
);

export function Quizzes() {
  const [range, setRange] = useState({});
  const [drink, setDrink] = useState("");
  const { data, error } = useData(() => api.quizzes({ ...range, drink }), [range.from, range.to, drink]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Дашборд опитувань</h1>
          <p>{fmt.dayFull(data.from)} — {fmt.dayFull(data.to)} · анкета профілю й відгуки про напої</p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Анкет профілю" value={fmt.int(data.profile.total)} note="за період" />
        <Kpi label="Відгуків про напої" value={fmt.int(data.drinks.total)} note={drink ? "за обраним напоєм" : "за всіма напоями"} />
        <Kpi label="Напоїв з відгуками" value={fmt.int(data.drinks.per_drink.length)} note="різних позицій меню" />
      </div>

      <div className="wrap-cols">
        <Card title="Анкета профілю" note={`${fmt.int(data.profile.total)} відповідей`}>
          <Questions block={data.profile} color="var(--accent)" />
        </Card>

        <div className="stack">
          <Card title="Напої" note="скільки відгуків зібрав кожен">
            <Bars
              items={data.drinks.per_drink.map((d) => ({ label: d.name ?? d.system_code, value: d.n }))}
              color="#4FA8FF"
            />
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                <select value={drink} onChange={(e) => setDrink(e.target.value)}>
                  <option value="">усі напої</option>
                  {data.drinks.per_drink.map((d) => (
                    <option key={d.system_code} value={d.system_code}>{d.name ?? d.system_code}</option>
                  ))}
                </select>
              </label>
            </div>
          </Card>
          <Card title="Відгуки про напій" note={drink ? drink : "усі напої разом"}>
            <Questions block={data.drinks} color="#3FBF6F" />
          </Card>
        </div>
      </div>
    </>
  );
}
