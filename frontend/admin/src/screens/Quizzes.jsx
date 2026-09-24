// Дашборд опитувань: анкета профілю й відгуки про напої
// (docs/admin_panel.md). Бонусні копії напою рахуються разом з основними —
// у них той самий номер позиції.
//
// Екран зібраний за кадром «Опитування» з design/admin: дві секції, картка
// на питання, всюди відсотки. Відсотки, а не штуки, — навмисно: «34 %
// беруть лате» читається одразу, а «64 відповіді» вимагає спершу знайти,
// скільки їх було всього (перероблено 24.09.2026 на прохання власника).
//
// Чого в макеті було, а тут немає: «середня оцінка 4.4 / 5». Пʼятибальної
// оцінки в анкеті немає — є чотири шкали з трьома варіантами, де середина
// означає «як має бути». Тому замість вигаданого бала показуємо частку
// влучань у норму: те саме за змістом, але його видно з даних.
import { useState } from "react";
import { api } from "../api.js";
import { Bars, Donut, Line } from "../charts.jsx";
import { Card, DateRange, Empty, Kpi, fmt, useData } from "../ui.jsx";

const BLUE = "#5AA9FF", VIOLET = "#B07CFF", AMBER = "#FFB020", GREEN = "#3FBF6F", GREY = "#8B94A3";
const RING = ["#FE810B", "#FF2D6F", "#5AA9FF", "#3FBF6F", "#B07CFF"];

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const answers = (n) => `${fmt.int(n)} ${fmt.plural(n, "відповідь", "відповіді", "відповідей")}`;

// Розкладка секції «Профіль» — з макета: три ряди, кільце там, де варіантів
// мало й вони діляться на ціле, смужки там, де їх багато. Дві дрібні шкали
// («Цукор», «Де пʼють») живуть у картці сусіда — окремою карткою вони б
// займали чверть екрана заради трьох рядків.
const ROWS = [
  [{ id: "age", ring: true, note: "анкети" }, { id: "gender", ring: true }, { id: "how_found", ring: true }],
  [{ id: "favourite_drink" }, { id: "frequency", also: "sugar", color: BLUE }, { id: "when", also: "where", color: BLUE }],
  [{ id: "values" }, { id: "milk", color: BLUE, grow: 0.8 }, { id: "other_drinks", color: VIOLET, grow: 1.15 }],
];

// Порядок і колір шкал напою — теж із макета.
const SCALES = [["coffee", "var(--grad)"], ["milk", BLUE], ["temperature", AMBER], ["cleanliness", GREEN]];

const CHIPS = 8;   // скільки напоїв показуємо до «ще N»

const hint = (q) => (q.type === "multi" ? "кілька варіантів" : q.type === "drinks" ? "один вибір" : "");

// Смужки у відсотках від числа ЛЮДЕЙ, а не від суми галочок: у питанні з
// кількома варіантами сума дає більше сотні, і це правильно — «смак кави
// важливий для 72 %» і «ціна для 61 %» не конкурують між собою.
const Shares = ({ q, color, label = 112 }) => (
  <Bars
    items={q.options.map((o) => ({ label: o.value, value: o.count }))}
    max={q.answered}
    format={(v) => pct(v, q.answered)}
    color={color}
    label={label}
  />
);

function Question({ q, spec }) {
  if (!q) return <Empty>немає відповідей</Empty>;
  if (spec?.ring) return <Donut items={q.options.map((o) => ({ label: o.value, value: o.count }))} colors={RING} />;
  return <Shares q={q} color={spec?.color ?? "var(--grad)"} />;
}

export function Quizzes() {
  const [range, setRange] = useState({});
  const [drink, setDrink] = useState("");
  const [all, setAll] = useState(false);
  const { data, error } = useData(() => api.quizzes({ ...range, drink }), [range.from, range.to, drink]);

  if (error) return <Empty>не вдалось прочитати: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const { profile, drinks } = data;
  const find = (list, id) => list.find((q) => q.question === id);
  const chosen = drinks.per_drink.find((d) => d.slot === drink);
  const title = chosen?.name ?? "усі напої";
  const shown = all ? drinks.per_drink : drinks.per_drink.slice(0, CHIPS);

  const day = (rows, name, color) => ({
    name, color,
    points: rows.map((r) => ({ x: `${r.day}T12:00:00Z`, y: r.share })),
  });
  const series = [
    ...(drink ? [day(drinks.by_day, title, "#FE810B")] : []),
    day(drinks.by_day_all, "усі напої", drink ? GREY : "#FE810B"),
  ];

  return (
    <>
      <div className="head">
        <div>
          <h1>Дашборд опитувань</h1>
          <p>{fmt.dayFull(data.from)} — {fmt.dayFull(data.to)} · бонусні копії рахуються з основними</p>
        </div>
        <div className="right"><DateRange value={range} onChange={setRange} /></div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Анкет профілю" value={fmt.int(profile.total)} note={`${pct(profile.filled, profile.players)} гравців заповнили`} />
        <Kpi label="Опитувань про напій" value={fmt.int(drinks.total_all)} note={`кредитів витрачено ${pct(drinks.credits.spent, drinks.credits.earned)}`} />
        <Kpi
          label="Влучань у норму"
          value={drinks.ideal_all === null ? "—" : pct(drinks.ideal_all, 1)}
          tone={drinks.ideal_all === null ? "" : drinks.ideal_all > 0.7 ? "ok" : "bad"}
          note="кава, молоко, температура, чистота"
        />
        <Kpi
          label="Скарг на чистоту"
          value={fmt.int(drinks.cleanliness.dirty)}
          tone={drinks.cleanliness.dirty ? "bad" : "ok"}
          note={`${pct(drinks.cleanliness.dirty, drinks.cleanliness.answered)} відповідей`}
        />
      </div>

      <div className="stack">
        <div className="sect">
          <b>Профіль</b>
          <span>анкета «Розкажи про себе» · {fmt.int(profile.filled)} {fmt.plural(profile.filled, "заповнена", "заповнені", "заповнених")}</span>
          <i />
        </div>

        {profile.total === 0 ? (
          <Empty>анкет за цей період немає</Empty>
        ) : ROWS.map((row, n) => (
          <div className="cols" key={n}>
            {row.map((spec) => {
              const q = find(profile.questions, spec.id);
              const extra = spec.also ? find(profile.questions, spec.also) : null;
              return (
                <Card
                  key={spec.id}
                  title={q?.title ?? spec.id}
                  note={spec.note ?? (q ? hint(q) : "")}
                  style={{ flex: spec.grow ?? 1 }}
                >
                  <Question q={q} spec={spec} />
                  {extra && (
                    <>
                      <div className="hr" style={{ margin: "10px 0 8px" }} />
                      <div className="sub-head" style={{ marginBottom: 8 }}>{extra.title}</div>
                      <Shares q={extra} color={spec.color ?? "var(--grad)"} />
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        ))}

        <div className="sect">
          <b>Опитування про напій</b>
          <span>{answers(drinks.total_all)}</span>
          <i />
          {/* Чіпси, а не список: напоїв у меню сімнадцять, а відгуки збирає
              менша частина — решта в «ще N», щоб ряд не переносився. */}
          <div className="chips">
            <button className={`pill${drink ? "" : " on"}`} onClick={() => setDrink("")}>Всі напої</button>
            {shown.map((d) => (
              <button key={d.slot} className={`pill${drink === d.slot ? " on" : ""}`} onClick={() => setDrink(d.slot)}>
                {d.name} · {d.n}
              </button>
            ))}
            {drinks.per_drink.length > CHIPS && (
              <button className="pill" onClick={() => setAll(!all)}>
                {all ? "згорнути" : `ще ${drinks.per_drink.length - CHIPS}`}
              </button>
            )}
          </div>
        </div>

        {drinks.total === 0 ? (
          <Empty>{drink ? `про «${title}» ще не відповідали` : "відповідей про напої за цей період немає"}</Empty>
        ) : (
          <div className="cols">
            {SCALES.map(([id, color], n) => {
              const q = find(drinks.questions, id);
              return (
                <Card key={id} title={q?.title ?? id} note={n === 0 ? `${title} · ${answers(drinks.total)}` : ""}>
                  {q ? <Shares q={q} color={color} label={88} /> : <Empty>немає відповідей</Empty>}
                </Card>
              );
            })}
          </div>
        )}

        <div className="cols">
          <Card title="Влучань у норму за добу" note={`${title} · частка «як має бути»`} style={{ flex: 1.3 }}>
            <Line series={series} max={1} height={128} format={(v) => `${Math.round(v * 100)}%`} />
          </Card>
          <Card title="Текстові відповіді" note={`${title} · ${fmt.int(drinks.texts_total)} з ${fmt.int(drinks.total)}`} style={{ flex: 1.2 }}>
            {drinks.texts.length === 0 ? (
              <Empty>відкритих відповідей немає</Empty>
            ) : (
              <div className="stack scroll" style={{ gap: 8, maxHeight: 190 }}>
                {drinks.texts.map((t) => (
                  <div className="quote" key={`${t.at}-${t.text}`}>
                    {/* Напій у рядку — лише коли дивимось усі разом: інакше
                        він повторює підпис картки в кожному рядку. */}
                    <p>{t.text}{!drink && <span className="muted"> · {t.drink}</span>}</p>
                    <time>{fmt.day(t.at)}</time>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
