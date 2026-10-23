// «Покупки» (кавʼярня): кожен чек Checkbox — позиції, бонус і хто його
// забрав, три миті покупки (вибір → оплата → готово) і хто стояв біля
// автомата з доказом із відео; окремою вкладкою — невдалі спроби. До
// 18.10.2026 той самий список був двічі: «Покупки» з бонусами й «Покупці» у
// відео з таймінгом (docs/admin_panel.md). Віддає api/src/routes/admin-sales.js.
import { useState } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Badge, DateRange, Empty, Kpi, Pager, Table, fmt, useData, usePage } from "../ui.jsx";
import { Evidence, Viewer } from "./Video.jsx";

const BONUS = {
  pending: ["warn", "чекає"], claimed: ["accent", "показаний"], redeemed: ["ok", "зарахований"],
  expired: ["", "згорів"], cancelled: ["", "скасований"],
};
const MATCH = { alone: ["біля автомата сам", "ok"], ambiguous: ["кілька людей поруч", "warn"] };
const UPLINK = { wifi: "Wi-Fi", lte: "LTE" };
const DAY = 86400_000;

const hhmmss = (t) => (t ? new Date(t).toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv" }) : "—");
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");
// Зсув від оплати зі знаком: вибір — мінус секунди до оплати, готово — плюс.
const offset = (t, paid) => {
  if (!t) return "—";
  const s = Math.round((new Date(t) - new Date(paid)) / 1000);
  return `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s)} с`;
};
// Дата «до» включно: до кінця обраного дня.
const params = (d) => ({ from: d.from, to: d.to ? new Date(+new Date(d.to) + DAY).toISOString().slice(0, 10) : undefined });

export function Purchases({ tab = "receipts" }) {
  const attempts = tab === "attempts";
  const [range, setRange] = useState({});
  const [page, setPage] = usePage(range.from, range.to, tab);
  const [view, setView] = useState(null);
  const { data: got, error, loading } = useData(
    () => (attempts ? api.receiptAttempts : api.receipts)({ ...params(range), page }).then((d) => ({ ...d, tab })),
    [range.from, range.to, page, tab]
  );
  // Відповідь іншої вкладки (поки нова їде) не малюємо — у неї інші колонки.
  const data = got?.tab === tab ? got : null;
  const open = (title, type, note) => (url, err) => setView({ title, type, url, error: err, note });

  const head = (
    <div className="head">
      <div>
        <h1>{attempts ? "Невдалі спроби" : "Покупки"}</h1>
        {/* «до» у запиті — початок наступного дня (params), тож показуємо обране. */}
        <p>{data ? `${fmt.dayFull(data.from)} — ${fmt.dayFull(range.to || data.to)}: ` : ""}
          {attempts
            ? "людина простояла біля автомата від 20 с, а чека поруч немає"
            : "чек, позиції, бонус і хто його забрав, миті покупки й хто стояв біля автомата"}</p>
      </div>
      <div className="right"><DateRange value={range} onChange={setRange} /></div>
    </div>
  );
  if (error) return <>{head}<Empty>не вдалось прочитати: {error.message}</Empty></>;
  if (!data) return <>{head}<Empty>вантажимо…</Empty></>;

  // KPI — з усього періоду (api рахує окремо), а не з видимої сторінки.
  const k = data.kpi;
  return (
    <>
      {head}
      {view && <Viewer key={view.url ?? "error"} view={view} onClose={() => setView(null)} />}
      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Чеків" value={fmt.int(k.real)} note={`без тестових і власника; разом із ними ${fmt.int(k.receipts)}`} />
        <Kpi label="Бонусів забрали" value={pct(k.redeemed, k.real)} note={`${fmt.int(k.redeemed)} чеків, за якими гравець забрав бонус`} />
        <Kpi label="Покупця видно" value={pct(k.seen, k.real)} note={`${fmt.int(k.seen)} чеків прив'язані до людини біля автомата`} />
        <Kpi label="Невдалих спроб" value={fmt.int(k.attempts_guests)} tone={k.attempts_guests ? "bad" : ""}
             note="стояли біля автомата від 20 с, а чека немає; без персоналу" />
      </div>

      {attempts ? (
        <>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Поруч — звʼязок малини з сервером у ці хвилини: якщо термінал оплати на точці ходить тим самим каналом,
            поганий звʼязок пояснює, чому платіж не пройшов.
          </p>
          <Table
            scroll
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
            foot={<Pager info={data.page} onPage={setPage} busy={loading} note="разом із персоналом" />}
          />
        </>
      ) : (
        <Table
          scroll
          columns={[
            {
              key: "fiscal_date", title: "оплата", render: (r) => (
                <span title={`джерело: ${r.source}`}>{fmt.time(r.fiscal_date)}<small>{r.point_name}</small></span>
              ),
            },
            {
              key: "items", title: "позиції", render: (r) => (
                <span>
                  {(r.items ?? []).map((i) => `${i.name}${i.bonus ? " (бонусний)" : ""} ×${Number(i.qty)}`).join(", ")
                    || r.drink || <span className="muted">—</span>}
                  {!r.in_stats && <small><Badge>тест / власник</Badge></small>}
                  {/* Машина позначила замовлення «Неуспішно» — напій не видано
                      (22.10.2026: лате без води, ERROR:7B00). */}
                  {r.order_status && r.order_status !== "Успішно" && (
                    <small><Badge tone="bad">машина не видала{r.fault ? ` · ${r.fault}` : ""}</Badge></small>
                  )}
                </span>
              ),
            },
            {
              key: "total_sum", title: "сума", num: true, render: (r) => (
                <span>
                  {fmt.uah(r.total_sum)}
                  {r.refund && <small><Badge tone="warn">повернуто {fmt.time(r.refund.at)}</Badge></small>}
                </span>
              ),
            },
            {
              key: "moments", title: "вибір → оплата → готово", render: (r) => (
                <span title={`вибір ${hhmmss(r.selected)} · оплата ${hhmmss(r.fiscal_date)} · готово ${hhmmss(r.done)}`}>
                  {offset(r.selected, r.fiscal_date)} · {hhmmss(r.fiscal_date)} · {offset(r.done, r.fiscal_date)}
                </span>
              ),
            },
            {
              key: "who", title: "покупець", render: (r) => {
                if (!r.in_stats) return <span className="muted">—</span>;
                if (!r.passage_id) return <span className="muted">{r.on_video ? "у кадрі біля автомата нікого" : "камера не писала"}</span>;
                const [label, tone] = MATCH[r.receipt_match] ?? ["?", ""];
                return <span className="row" style={{ gap: 4 }}><Badge tone={tone}>{label}</Badge>{r.staff && <Badge tone="warn">персонал</Badge>}</span>;
              },
            },
            {
              key: "evidence", title: "доказ", render: (r) => (r.event_id
                ? <Evidence e={{ id: r.event_id, kind: r.event_kind, started_at: r.fiscal_date, evidence: r.evidence, passage_id: r.passage_id, crops: r.crops?.length ?? 0 }} open={open} />
                : <span className="muted">—</span>),
            },
            {
              key: "bonus", title: "бонус", render: (r) => {
                if (!r.bonus_status) return <span className="muted">без бонусу</span>;
                const [tone, text] = BONUS[r.bonus_status] ?? ["", r.bonus_status];
                return <span className="row" style={{ gap: 6 }}><Badge tone={tone}>{text}</Badge><span className="muted">{fmt.int(r.bonus_coins)} монет</span></span>;
              },
            },
            {
              key: "redeemed_nickname", title: "хто забрав", render: (r) => (r.redeemed_by
                ? <span><button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => go(`users/${r.redeemed_by}`)}>{r.redeemed_nickname}</button>{r.redeemed_excluded && <small>поза статистикою</small>}</span>
                : <span className="muted">—</span>),
            },
            {
              key: "tax_url", title: "", render: (r) => (r.tax_url
                ? <a href={r.tax_url} target="_blank" rel="noreferrer" className="muted">чек ДПС ↗</a>
                : null),
            },
          ]}
          rows={data.receipts}
          empty="чеків за цей період немає"
          foot={<Pager info={data.page} onPage={setPage} busy={loading} note="разом із тестовими — KPI вище без них" />}
        />
      )}
    </>
  );
}
