// Графіки адмінки: смужка-пульс, лінія й стовпчики. Вони живуть окремо від
// решти UI навмисно — це єдине місце, де є арифметика координат, і його
// правлять інакше, ніж картки й таблиці: спершу міряють, потім рухають
// (questions.md, питання 8 — власник попросив тримати це інкапсульованим).
//
// Бібліотеки тут немає й не треба: три примітиви в SVG важать менше, ніж
// будь-який чарт-пакет, і не тягнуть у збірку свою модель даних.
import { useEffect, useRef, useState } from "react";
import { Dot, Empty, fmt } from "./ui.jsx";

// Смужка пульсу: рядок «1/0/?» на півгодинне відро (api віддає саме так).
//
// SVG, а не 337 <i> у флексі (переписано 24.09.2026). Тиждень півгодинними
// відрами — це 337 колонок на ~600 px: у флексі з `gap: 1px` самі зазори
// зʼїдали 336 px із 339, на дані лишалось по 0.46 px на відро, і браузер
// округляв кожне до нуля або одного пікселя. Виходив ритмічний візерунок
// із груп і прогалин, якого в даних немає, — власник резонно спитав, що він
// означає. Тепер ширина відра — дробова одиниця viewBox, і всі вони рівні
// за визначенням, як би не змінювалась ширина екрана.
export function Beat({ history, title }) {
  const line = history?.line ?? "";
  const step = history?.step ?? 1800_000;
  const from = history?.from ?? 0;
  const fails = new Map((history?.fails ?? []).map((f) => [f.t, f.detail]));
  if (!line.length) return <svg className="beat" viewBox="0 0 1 1" preserveAspectRatio="none" />;
  return (
    <svg className="beat" viewBox={`0 0 ${line.length} 1`} preserveAspectRatio="none" aria-label={title}>
      {[...line].map((c, i) => {
        const t = from + i * step;
        const detail = fails.get(t);
        const when = new Date(t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return (
          <rect key={i} data-s={c} x={i + 0.1} width={0.8} y={0} height={1}>
            <title>{c === "?" ? `${when}: проб не було` : c === "1" ? `${when}: усе гаразд` : `${when}: ${detail ?? "падало"}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// Підписи під смужкою: коли починається історія, середина й «зараз».
// Без них пульс — просто набір квадратиків: незрозуміло, це падало вчора
// чи п'ять хвилин тому.
export function BeatScale({ history }) {
  const step = history?.step ?? 1800_000;
  const from = history?.from ?? 0;
  const len = (history?.line ?? "").length;
  if (!len) return null;
  const at = (i) => new Date(from + i * step).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
  return (
    <div className="beat-scale">
      <span>{at(0)}</span>
      <span>{at(Math.floor(len / 2))}</span>
      <span>зараз</span>
    </div>
  );
}

// ms — середня затримка проби за останнє відро; у компонентів без HTTP
// (черга outbox, heartbeat) її немає, і тоді колонка просто порожня.
// sub — підрядок під точкою (монітор, відеопотік): той самий рядок із
// відступом. children замість смужки — для рядків, у яких історії немає, а
// є самі числа: колонки лишаються ті самі, тож підписи справа не їдуть.
export const BeatRow = ({ ok, name, note, value, history, ms = null, sub = false, children = null, onClick = null }) => (
  <div className={`beat-row${sub ? " sub" : ""}`} onClick={onClick ?? undefined}
       style={onClick ? { cursor: "pointer" } : undefined} data-click={onClick ? "1" : undefined}>
    <span className="name"><Dot ok={ok} />{name}</span>
    {children ?? <Beat history={history} title={note} />}
    <span className="ms">{ms === null ? "" : `${fmt.int(ms)} мс`}</span>
    <span className="value">{value}</span>
  </div>
);

// Розриви в ряду. Точка мовчала десять годин — і лінія чесно має розірватись,
// а не зʼєднати вечір із ранком прямою, по якій не видно, що між ними нічого
// не було (знайшов власник 25.09.2026: смужки вгорі сірі, а графіки під ними
// показують бадьоре життя).
//
// Поріг не константа: ряди сюди приходять із різним кроком (проба малини раз
// на хвилину, добові підсумки раз на добу), і одне число для всіх або рвало б
// суцільні ряди, або не рвало б жодного. Беремо МЕДІАНУ кроку — вона не
// зважає на самі дірки, — і рвемо там, де проміжок утричі більший.
const GAP_FACTOR = 3;

function segments(points, gapMs) {
  const sorted = [...points].sort((a, b) => +new Date(a.x) - +new Date(b.x));
  if (sorted.length < 2) return sorted.length ? [sorted] : [];
  let limit = gapMs;
  if (!limit) {
    const steps = sorted.slice(1)
      .map((p, i) => +new Date(p.x) - +new Date(sorted[i].x))
      .sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)] || 0;
    limit = median > 0 ? median * GAP_FACTOR : Infinity;
  }
  const out = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = +new Date(sorted[i].x) - +new Date(sorted[i - 1].x);
    if (gap > limit) out.push([]);
    out.at(-1).push(sorted[i]);
  }
  return out;
}

// Лінійний графік: кілька рядів, спільна шкала. Пусті дані — чесний підпис,
// а не порожня сітка.
//
// area — заливка під лінією (0.2 прозорості, як у макеті). У дизайні нею
// показують «скільки», а чистою лінією — «як змінюється»: дохід, покупки й
// монети залиті, а зерна ні. Робимо так само.
// max — коли шкала відома наперед. Для часток це 1: інакше графік
// розтягується під власний максимум, і просідання з 88 % до 84 % виглядає
// як обвал (дашборд опитувань, 24.09.2026).
// legend — підпис під графіком. На картці з кількома лініями він потрібен,
// а там, де ряд один і його назва вже стоїть заголовком над графіком,
// повторює її вдруге.
// gapMs — з якого проміжку між точками вважати, що даних не було. За
// замовчуванням рахується з самого ряду (див. segments вище).
export function Line({ series, height = 150, format = fmt.int, area = false, max: maxProp = null, legend = true, gapMs = 0 }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const points = series.flatMap((s) => s.points);
  const has = points.length > 0;
  const max = maxProp ?? Math.max(1, ...points.map((p) => p.y));
  const xs = [...new Set(points.map((p) => +new Date(p.x)))].sort((a, b) => a - b);
  const padL = 34, padB = 16, padT = 8;
  const innerW = Math.max(40, w - padL - 6);
  const innerH = height - padB - padT;
  const x = (t) => padL + (xs.length < 2 ? innerW / 2 : (innerW * (+new Date(t) - xs[0])) / (xs.at(-1) - xs[0]));
  const y = (v) => padT + innerH - (innerH * v) / max;
  const cut = series.map((s) => ({ ...s, runs: segments(s.points, gapMs) }));

  return (
    <div ref={ref}>
      {!has ? (
        <Empty>даних за цей період немає</Empty>
      ) : (
        <>
          <svg className="chart" viewBox={`0 0 ${w} ${height}`} height={height}>
            {[0, 0.5, 1].map((k) => (
              <g key={k}>
                <line className="grid-line" x1={padL} x2={w - 6} y1={y(max * k)} y2={y(max * k)} />
                <text className="axis" x={0} y={y(max * k) + 3}>{format(max * k)}</text>
              </g>
            ))}
            {area && cut.flatMap((s) => s.runs.map((run, n) => (
              <path
                key={`${s.name}-area-${n}`}
                fill={s.color}
                fillOpacity="0.2"
                stroke="none"
                d={`M${run.map((p) => `${x(p.x)},${y(p.y)}`).join("L")}L${x(run.at(-1).x)},${y(0)}L${x(run[0].x)},${y(0)}Z`}
              />
            )))}
            {cut.flatMap((s) => s.runs.map((run, n) => (
              // Одинока точка між двома дірками — крапка: polyline нульової
              // довжини браузер не малює взагалі, і проба виглядала б як
              // відсутня.
              run.length === 1 ? (
                <circle key={`${s.name}-dot-${n}`} cx={x(run[0].x)} cy={y(run[0].y)} r="1.6" fill={s.color} />
              ) : (
                <polyline
                  key={`${s.name}-${n}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  points={run.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
                />
              )
            )))}
            {xs.length > 1 && [xs[0], xs.at(-1)].map((t, i) => (
              <text key={t} className="axis" x={i ? w - 30 : padL} y={height - 3}>{fmt.day(t)}</text>
            ))}
          </svg>
          {legend && (
            <div className="legend">
              {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Колонки: розподіл за часом (кадри «Дохід за годиною дня» / «за днями
// тижня»). Від Bars відрізняється тим, що читається як доба: 24 значення
// поруч, а не 24 рядки один під одним. Прозорість росте з висотою — у
// макеті саме так видно «пік о восьмій» навіть боковим зором.
export function Columns({ items, format = fmt.int, color = "#FE810B", every = 1 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const H = 190, gap = 0.38;              // gap — частка кроку між колонками
  const step = 560 / Math.max(1, items.length);
  const w = step * (1 - gap);
  if (!items.length) return <Empty>даних за цей період немає</Empty>;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 560 ${H}`} height={150} preserveAspectRatio="none">
        {items.map((i, n) => {
          const h = (H * i.value) / max;
          return (
            <rect
              key={i.label}
              x={n * step + (step - w) / 2}
              y={H - h}
              width={w}
              height={h}
              rx="2"
              fill={color}
              opacity={0.6 + 0.4 * (i.value / max)}
            >
              <title>{`${i.label}: ${format(i.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="col-labels">
        {items.map((i, n) => <span key={i.label}>{n % every === 0 ? i.label : ""}</span>)}
      </div>
    </div>
  );
}

// Бублик: частки одного цілого (кадр «Взаємодія з бонусами»). Легенда —
// праворуч, із відсотком: без нього кільце показує пропорцію, але не
// відповідає на питання «скільки це».
export function Donut({ items, colors = ["#FE810B", "#FFB020", "#8B94A3"] }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return <Empty>даних за цей період немає</Empty>;
  const R = 55, C = 2 * Math.PI * R;
  let done = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 128 128" width="126" height="126">
        {items.map((i, n) => {
          const len = (C * i.value) / total;
          const offset = -done;
          done += len;
          return (
            <circle
              key={i.label}
              cx="64" cy="64" r={R} fill="none"
              stroke={colors[n % colors.length]}
              strokeWidth="18"
              strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`}
              strokeDashoffset={offset.toFixed(1)}
              transform="rotate(-90 64 64)"
            />
          );
        })}
      </svg>
      <div className="stack" style={{ gap: 7, flex: 1, minWidth: 0 }}>
        {items.map((i, n) => (
          <div key={i.label} className="row" style={{ gap: 7, fontSize: 11.5 }}>
            <i className="chip" style={{ background: colors[n % colors.length] }} />
            <span style={{ flex: 1, minWidth: 0, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</span>
            <b>{Math.round((i.value / total) * 100)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// Стовпчики: для розподілів (відповіді квізів, події за днями).
//
// label — скільки місця під підпис. За замовчуванням 150: підписи подій
// довгі. На дашборді опитувань таких карток три в ряд, і там підпис
// вужчий, інакше сама смужка стискається до нечитабельної.
export function Bars({ items, max: maxProp, format = fmt.int, color = "var(--accent)", label = 150 }) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <Empty>немає відповідей</Empty>;
  return (
    <div className="stack" style={{ gap: 7 }}>
      {items.map((i) => (
        <div key={i.label} className="row" style={{ gap: 8 }}>
          <span style={{ width: label, flex: "none", fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.label}>{i.label}</span>
          <span style={{ flex: 1, height: 14, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(i.value / max) * 100}%`, background: color, borderRadius: 4 }} />
          </span>
          <b style={{ width: 46, textAlign: "right", fontSize: 11.5 }}>{format(i.value)}</b>
        </div>
      ))}
    </div>
  );
}

// Проміжок дат: типово 30 днів, як у доці.
