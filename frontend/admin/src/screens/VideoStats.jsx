// Відео → «Аналітика» і «Покупці» (власник, 15.10.2026): скільки людей
// буває в клубі, скільки з них доходить до автомата й купує, скільки сидять,
// коли камера чи кавомашина не працювали — і кожна покупка з трьома митями
// й тим, хто стояв біля автомата. Рахує worker (проходи, люди, візити —
// backend/worker/worker/people.py), віддає api/src/routes/video-stats.js.
//
// Відвідувач — людина, яку впізнавання склало з проходів коридором за
// одягом, без персоналу (12+ проходів за добу). Це оцінка, а не лічильник
// на дверях: пороги й похибки — docs/video.md, «Люди й візити».
import { useState } from "react";
import { api } from "../api.js";
import { Bars, Columns, Line } from "../charts.jsx";
import { Badge, Card, DateRange, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";
import { Evidence, Viewer } from "./Video.jsx";

const DAY = 86400_000;
const KYIV = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
// Година в київському часі: { day: "2026-10-14", hour: 23 }.
const kyiv = (t) => {
  const p = Object.fromEntries(KYIV.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const hhmmss = (t) => (t ? new Date(t).toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv" }) : "—");
const minutes = (m) => (m == null ? "—" : m < 60 ? `${Math.round(m)} хв` : `${Math.floor(m / 60)} год ${Math.round(m % 60)} хв`);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");

function useDates() {
  const to = new Date();
  return useState({ from: new Date(to - 7 * DAY).toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
}
// Дата «до» включно: до кінця обраного дня.
const params = (d) => ({ from: d.from, to: d.to ? new Date(+new Date(d.to) + DAY).toISOString().slice(0, 10) : undefined });

const KINDS = [
  ["pass", "пройшли повз", "#5AA9FF"],
  ["approach", "підійшли", "#FE810B"],
  ["machine", "біля автомата", "#B07CFF"],
  ["queue", "черга", "#3FBF6F"],
  ["receipt", "чеки", "#FF2D6F"],
];

// Смужка покриття: рядок — київська доба, клітинка — година. Зелене —
// частка години, яку писала камера; червона риска знизу — кавомашина
// жодного разу не була на звʼязку (немає світла чи звʼязку); сіре — запису
// немає. Без цього нулі в графіках не відрізнити від «камера не писала».
function Coverage({ rows }) {
  const days = new Map();
  for (const r of rows) {
    const { day, hour } = kyiv(r.hour);
    if (!days.has(day)) days.set(day, Array(24).fill(null));
    days.get(day)[hour] = r;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "58px repeat(24, 1fr)", gap: 2, fontSize: 10 }}>
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="muted" style={{ textAlign: "center" }}>{h % 3 ? "" : h}</span>)}
      {[...days].map(([day, cells]) => [
        <span key={day} className="muted">{day.slice(8, 10)}.{day.slice(5, 7)}</span>,
        ...cells.map((c, h) => {
          const share = c ? Math.min(1, c.video_s / 3600) : 0;
          const down = c && c.n > 0 && !c.up;
          const title = c ? `${day} ${h}:00 — запис ${Math.round(share * 100)} %` +
            (c.n ? `; кавомашина на звʼязку ${c.up} з ${c.n} проб` : "; проб кавомашини немає") : "";
          return (
            <span key={`${day}-${h}`} title={title} style={{
              height: 14, borderRadius: 2,
              background: share ? `rgba(63, 191, 111, ${0.25 + 0.75 * share})` : "var(--line)",
              boxShadow: down ? "inset 0 -3px 0 #FF2D6F" : "none",
            }} />
          );
        }),
      ])}
    </div>
  );
}

export function VideoAnalytics() {
  const [dates, setDates] = useDates();
  const { data, error } = useData(() => api.videoAnalytics(params(dates)), [dates.from, dates.to]);
  const head = (
    <div className="head">
      <div>
        <h1>Аналітика відео</h1>
        <p>відвідувачі, воронка до покупки, години, скільки сидять</p>
      </div>
      <DateRange value={dates} onChange={setDates} />
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;

  const days = data.days.filter((d) => d.visitors > 0);
  const avg = days.length ? days.reduce((n, d) => n + d.visitors, 0) / days.length : 0;
  const f = data.funnel;
  const receipts = new Map(data.receipts_by_day.map((r) => [r.day, r.receipts]));
  const buckets = [...new Set(data.events3h.map((r) => r.bucket))].sort();
  const dw = data.dwell;

  return (
    <>
      {head}
      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Відвідувачів за добу" value={fmt.int(Math.round(avg))}
             note={`у середньому за ${days.length} ${fmt.plural(days.length, "добу", "доби", "діб")} з записом; без персоналу`} />
        <Kpi label="Доходять до автомата" value={pct(f.at_machine, f.visitors)}
             note={`${fmt.int(f.at_machine)} з ${fmt.int(f.visitors)} людей стояли впритул до автомата`} />
        <Kpi label="Купують" value={pct(f.buyers, f.at_machine)}
             note={`${fmt.int(f.buyers)} покупців з тих, хто дійшов до автомата`} />
        <Kpi label="Сидять у клубі" value={minutes(dw.median_min)}
             note={`медіана з ${fmt.int(dw.closed)} візитів, де видно і вхід, і вихід; середнє ${minutes(dw.mean_min)}`} />
      </div>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="Воронка" note="унікальні люди за період, без персоналу">
          <Bars items={[
            { label: "у кадрі", value: f.visitors },
            { label: "біля кавʼярні від 4 с", value: f.at_cafe },
            { label: "впритул до автомата", value: f.at_machine },
            { label: "купили (чек у мить)", value: f.buyers },
          ]} label={170} />
        </Card>
        <Card title="Відвідувачі по днях" note="люди, яких камера бачила за київську добу">
          <Columns items={data.days.map((d) => ({ label: fmt.day(`${d.day}T12:00:00`), value: d.visitors }))} />
        </Card>
      </div>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="У клубі по годинах" note="середнє за доби, коли ця година була записана">
          <Columns items={Array.from({ length: 24 }, (_, h) => ({
            label: String(h).padStart(2, "0"),
            value: data.hourly.find((r) => r.hour === h)?.present ?? 0,
          }))} format={(v) => v.toFixed(1)} every={3} />
        </Card>
        <Card title="Скільки сидять" note={`візити з відомими входом і виходом: ${fmt.int(dw.closed)} з ${fmt.int(dw.all_visits)}`}>
          <Bars items={[
            { label: "до 15 хв", value: dw.b15 }, { label: "15–30 хв", value: dw.b30 },
            { label: "30–60 хв", value: dw.b60 }, { label: "1–2 год", value: dw.b120 },
            { label: "2–4 год", value: dw.b240 }, { label: "4 год і більше", value: dw.b_more },
          ]} color="#5AA9FF" />
        </Card>
      </div>

      <Card title="Події по три години" note="разом із чеками: де люди є, а покупок немає" style={{ marginBottom: 12 }}>
        <Line series={KINDS.map(([kind, name, color]) => ({
          name, color,
          points: buckets.map((b) => ({ x: b, y: data.events3h.find((r) => r.bucket === b && r.kind === kind)?.n ?? 0 })),
        }))} height={180} />
      </Card>

      <Card title="Коли камера писала" note="зелене — частка години з записом; червона риска — кавомашина не на звʼязку" style={{ marginBottom: 12 }}>
        <Coverage rows={data.coverage} />
      </Card>

      <div className="grid k2" style={{ marginBottom: 12 }}>
        <Card title="Що пʼють" note="позиції чеків за період">
          <Bars items={data.drinks.map((d) => ({ label: d.name, value: d.qty }))} label={170} />
        </Card>
        <Card title="Втрачені вікна" note="люди в коридорі, а кавомашина не на звʼязку">
          {data.lost.length === 0 ? <Empty>таких годин не було</Empty> : (
            <Table columns={[
              { key: "hour", title: "година", render: (r) => fmt.time(r.hour) },
              { key: "people", title: "людей", num: true },
            ]} rows={data.lost} />
          )}
        </Card>
      </div>

      <Table
        columns={[
          { key: "day", title: "доба", render: (d) => fmt.dayFull(`${d.day}T12:00:00`) },
          { key: "visitors", title: "відвідувачі", num: true },
          { key: "staff", title: "персонал", num: true },
          { key: "at_machine", title: "біля автомата", num: true },
          { key: "buyers", title: "покупці з відео", num: true },
          { key: "receipts", title: "чеків", num: true, render: (d) => receipts.get(d.day) ?? 0 },
          { key: "entries", title: "входів / виходів", num: true, render: (d) => `${d.entries} / ${d.exits}` },
          { key: "passages", title: "проходів", num: true },
        ]}
        rows={data.days}
        empty="за цей період проходів немає"
      />
    </>
  );
}

const MATCH = { alone: ["біля автомата сам", "ok"], ambiguous: ["кілька людей поруч", "warn"] };
const UPLINK = { wifi: "Wi-Fi", lte: "LTE" };

export function VideoPurchases() {
  const [dates, setDates] = useDates();
  const [view, setView] = useState(null);
  const { data, error } = useData(() => api.videoPurchases(params(dates)), [dates.from, dates.to]);
  const open = (title, type, note) => (url, err) => setView({ title, type, url, error: err, note });
  const head = (
    <div className="head">
      <div>
        <h1>Покупці на відео</h1>
        <p>кожен чек — вибір напою, оплата, готовий напій і хто стояв біля автомата</p>
      </div>
      <DateRange value={dates} onChange={setDates} />
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;

  const real = data.purchases.filter((p) => p.in_stats);
  const seen = real.filter((p) => p.passage_id);
  // Зсув від оплати зі знаком: вибір — мінус секунди до оплати, готово — плюс.
  const offset = (t, paid) => {
    if (!t) return "—";
    const s = Math.round((new Date(t) - new Date(paid)) / 1000);
    return `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s)} с`;
  };

  return (
    <>
      {head}
      {view && <Viewer key={view.url ?? "error"} view={view} onClose={() => setView(null)} />}
      <div className="grid k3" style={{ marginBottom: 12 }}>
        <Kpi label="Чеків" value={fmt.int(real.length)} note="без тестових і власника (receipt_in_stats)" />
        <Kpi label="Покупця видно" value={pct(seen.length, real.length)}
             note={`${fmt.int(seen.length)} чеків прив'язані до людини біля автомата`} />
        <Kpi label="Невдалих спроб" value={fmt.int(data.attempts.filter((a) => !a.staff).length)}
             note="стояли біля автомата від 20 с, а чека немає; без персоналу" />
      </div>

      <h2 className="section-title">Покупки</h2>
      <Table
        columns={[
          { key: "paid", title: "оплата", render: (p) => fmt.time(p.paid) },
          { key: "drink", title: "напій", render: (p) => p.drink ?? <span className="muted">—</span> },
          { key: "total", title: "сума", num: true, render: (p) => fmt.uah(p.total) },
          {
            key: "moments", title: "вибір → оплата → готово", render: (p) => (
              <span title={`вибір ${hhmmss(p.selected)} · оплата ${hhmmss(p.paid)} · готово ${hhmmss(p.done)}`}>
                {offset(p.selected, p.paid)} · {hhmmss(p.paid)} · {offset(p.done, p.paid)}
              </span>
            ),
          },
          {
            key: "who", title: "покупець", render: (p) => {
              if (!p.in_stats) return <Badge>тест / власник</Badge>;
              if (!p.passage_id) return <span className="muted">{p.on_video ? "у кадрі біля автомата нікого" : "камера не писала"}</span>;
              const [label, tone] = MATCH[p.receipt_match] ?? ["?", ""];
              return <span className="row" style={{ gap: 4 }}><Badge tone={tone}>{label}</Badge>{p.staff && <Badge tone="warn">персонал</Badge>}</span>;
            },
          },
          {
            key: "evidence", title: "доказ", render: (p) => (p.event_id
              ? <Evidence e={{ id: p.event_id, kind: p.event_kind, started_at: p.paid, evidence: p.evidence, passage_id: p.passage_id, crops: p.crops?.length ?? 0 }} open={open} />
              : <span className="muted">—</span>),
          },
        ]}
        rows={data.purchases}
        empty="чеків за цей період немає"
      />

      <h2 className="section-title">Невдалі спроби</h2>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        Людина простояла біля автомата від 20 секунд, а чека поруч немає. Поруч — звʼязок малини з сервером у ці
        хвилини: термінал оплати ходить через той самий 4G-роутер і запасного каналу не має (14.10 о 23:36 платіж
        не пройшов саме так).
      </p>
      <Table
        columns={[
          { key: "started_at", title: "коли", render: (a) => fmt.time(a.started_at) },
          { key: "secs", title: "стояли", num: true, render: (a) => `${a.secs} с` },
          { key: "staff", title: "хто", render: (a) => (a.staff ? <Badge tone="warn">персонал</Badge> : <span className="muted">гість</span>) },
          {
            key: "net", title: "звʼязок", render: (a) => (a.net?.samples ? (
              <span style={a.net.loss_max >= 10 ? { color: "var(--bad)" } : undefined}>
                втрати до {Math.round(a.net.loss_max ?? 0)} %, пінг до {Math.round(a.net.ping_max ?? 0)} мс
                {a.net.uplinks?.length ? ` · ${a.net.uplinks.map((u) => UPLINK[u] ?? u).join(" → ")}` : ""}
              </span>
            ) : <span className="muted">телеметрії немає</span>),
          },
          { key: "machine_online", title: "кавомашина", render: (a) => (a.machine_online == null ? "—" : a.machine_online === "true" ? "на звʼязку" : <span style={{ color: "var(--bad)" }}>не на звʼязку</span>) },
          { key: "evidence", title: "доказ", render: (a) => <Evidence e={{ ...a, kind: "machine" }} open={open} /> },
        ]}
        rows={data.attempts}
        empty="невдалих спроб не було"
      />
    </>
  );
}
