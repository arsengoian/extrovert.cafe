// POS: телеметрія однієї точки (docs/admin_panel.md, «телеметрія кожної POS»).
//
// Малина збирає метрики локально й досилає їх пачками, тому графік будуємо
// за measured_at, а не за часом отримання: проґавлений інтернет має
// виглядати як пізні точки на тій самій лінії, а не як діра.
import { useState } from "react";

import { api } from "../api.js";
import { go } from "../app.jsx";
import { Beat, Line, TimeScale } from "../charts.jsx";
import { Badge, Card, Empty, Kpi, LOSS_BAD_PCT, METRIC_LABELS as LABELS, Pager, RangePicker, Table, UPLINK, fmt, metricValue as human, rangeLabel, useData, usePage, useRange } from "../ui.jsx";

// Булеві показники, для яких малюємо тижневу смужку. `pick` повертає
// true/false або null — «проби не було й судити нема з чого».
//
// Памʼяті тут немає навмисно: у неї є своя лінія нижче, а «є запас / немає
// запасу» на тижневій смужці однаково зелене й не каже нічого, чого не
// видно з графіка (прохання власника 24.09.2026).
// why — що саме не так у поганій пробі, для тултіпа червоного відра; rank —
// наскільки погано (більше — гірше): з кількох поганих проб відра в тултіп
// іде найгірша. Досі там стояло просто «падало» (власник, 14.10.2026).
const SIGNALS = [
  { key: "monitor", name: "монітор", note: "за CEC",
    pick: (m) => (m.monitor_on === undefined ? null : m.monitor_on),
    why: (m) => `${m.monitor_src === "cec" ? "монітор у режимі очікування (CEC)" : `монітор не відповідає (${m.monitor_src ?? "?"})`}${m.monitor_woke ? ", будили" : ""}` },
  { key: "kiosk", name: "кіоск малює", note: null,
    pick: (m) => (m.kiosk_fps === undefined || m.kiosk_fps === null ? null : Number(m.kiosk_fps) > 0),
    why: (m) => `кіоск не малює: fps ${m.kiosk_fps}` },
  { key: "card", name: "картка пишеться", note: null,
    pick: (m) => (m.root_ro === undefined || m.root_ro === null ? null : m.root_ro === false),
    why: () => "картка стала read-only" },
  { key: "usb", name: "флешка", note: "змонтована, пишеться",
    pick: (m) => (m.usb_ok === undefined ? null : m.usb_ok),
    why: () => "флешка не змонтована або не пишеться" },
  // Поріг і чому саме такий — LOSS_BAD_PCT в ui.jsx (14.10.2026).
  { key: "net", name: "пінг до сервера", note: "червоне — 2 з 5 загублено",
    pick: (m) => (m.loss_pct === undefined || m.loss_pct === null ? null : Number(m.loss_pct) < LOSS_BAD_PCT),
    why: (m) => (Number(m.loss_pct) >= 100 ? "сервер недосяжний: усі пінги загубились"
      : `втрати ${m.loss_pct} %${m.ping_ms != null ? `, пінг ${m.ping_ms} мс` : ""}`)
      + (m.uplink ? ` (через ${UPLINK[m.uplink] ?? m.uplink})` : ""),
    rank: (m) => Number(m.loss_pct) },
  { key: "video", name: "відеопотік", note: "свіжі сегменти з камери",
    pick: (m) => (m.video_ok === undefined ? null : m.video_ok),
    why: () => "запис не йде: свіжих сегментів із камери немає" },
  { key: "temp", name: "температура", note: "червоне від 80 °C",
    pick: (m) => (m.temp_c === undefined || m.temp_c === null ? null : Number(m.temp_c) < 80),
    why: (m) => `${m.temp_c} °C`, rank: (m) => Number(m.temp_c) },
];

// Те саме для кавомашини. Проби рідші (раз на пів години проти хвилини в
// малини), тож у півгодинному відрі зазвичай рівно одна — смужка виходить
// суцільною, без «?» між пробами. Відповідає на те саме питання, що й
// смужки малини: не «як зараз», а «коли саме стало погано».
const JET_SIGNALS = [
  { key: "jet_session", name: "сесія порталу", note: "вхід на портал Jetinno",
    pick: (m) => (m.session === undefined ? null : Boolean(m.session)),
    why: () => "вхід на портал Jetinno злетів" },
  { key: "jet_online", name: "машина на звʼязку", note: "портал її бачить",
    pick: (m) => (m.online === undefined ? null : Boolean(m.online)),
    why: (m) => `портал не бачить машину${m.last_login ? `, востаннє ${fmt.time(m.last_login)}` : ""}` },
  { key: "jet_faults", name: "без несправностей", note: null,
    pick: (m) => (m.fault_codes !== undefined ? !m.fault_codes.length
      : m.faults === undefined ? null : !Number(m.faults)),
    why: (m) => (m.fault_codes?.length ? m.fault_codes.join("; ") : `лічильник несправностей: ${m.faults}`),
    rank: (m) => m.fault_codes?.length ?? Number(m.faults) },
  { key: "jet_warnings", name: "без попереджень", note: null,
    pick: (m) => (m.warnings === undefined ? null : !Number(m.warnings)),
    why: (m) => `попереджень: ${m.warnings}`, rank: (m) => Number(m.warnings) },
  { key: "jet_supply", name: "інгредієнти", note: "без дефіциту",
    pick: (m) => (m.supply_short === undefined ? null : !Number(m.supply_short)),
    why: (m) => `дефіцит інгредієнтів: ${m.supply_short}`, rank: (m) => Number(m.supply_short) },
  { key: "jet_reconcile", name: "замовлення ↔ чеки", note: "за добу, мають сходитись",
    pick: (m) => (m.reconcile_ok === undefined ? null : Boolean(m.reconcile_ok)),
    why: (m) => `замовлень карткою ${m.orders_card_24h ?? "?"}, готівкою ${m.orders_cash_24h ?? "?"}, чеків ${m.receipts_24h ?? "?"} (за добу)` },
];

// Що малюємо лініями під мережею: три показники, по яких видно, що точці
// стає зле ще до того, як щось упаде (прохання власника 24.09.2026).
// CPU — 01.10.2026: малина його й так шле кожну пробу, а на одноядерному
// Pi 1 саме він першим каже, що кіоск чимось задавлений.
const HARDWARE = [
  { key: "cpu", name: "CPU, %", color: "#FF6B7A", format: (v) => v.toFixed(0) },
  { key: "mem_used_mb", name: "памʼять, МБ", color: "#5AA9FF", format: (v) => Math.round(v).toLocaleString("uk-UA") },
  { key: "kiosk_fps", name: "fps кіоска", color: "#B07CFF", format: (v) => v.toFixed(0) },
  { key: "temp_c", name: "температура, °C", color: "#FFB020", format: (v) => v.toFixed(0) },
  { key: "disk_free_mb", name: "диск вільно, МБ", color: "#3FBF6F", format: (v) => Math.round(v).toLocaleString("uk-UA") },
];

// Проби телеметрії → та сама структура, яку малює Beat (charts.jsx): рядок
// «1/0/?» по відру кроку обраного періоду (півгодини, на місяці — дві
// години; вікно й крок каже сервер). Рахуємо на клієнті, бо історія проб
// уже приїхала разом зі сторінкою — окремий запит тут був би за тими самими
// даними.
// Для червоного відра — що саме було не так (sig.why) у найгіршій пробі
// (sig.rank) і скільки проб відра були поганими.
function boolSeries(history, sig, { hours, step }) {
  const buckets = new Map();
  for (const h of history) {
    const m = h.metrics ?? {};
    const v = sig.pick(m);
    if (v === null || v === undefined) continue;
    const t = Math.floor(new Date(h.measured_at).getTime() / step) * step;
    const b = buckets.get(t) ?? { ok: true, bad: 0, total: 0, worst: null, rank: -Infinity };
    b.total += 1;
    if (!v) {
      b.ok = false; b.bad += 1;
      const r = sig.rank ? sig.rank(m) : 0;
      if (b.worst === null || r > b.rank) { b.worst = m; b.rank = r; }
    }
    buckets.set(t, b);
  }
  const last = Math.floor(Date.now() / step) * step;
  const from = last - hours * 3600_000;
  let line = "";
  const fails = [];
  for (let t = from; t <= last; t += step) {
    const b = buckets.get(t);
    line += b ? (b.ok ? "1" : "0") : "?";
    if (b && !b.ok) {
      const what = sig.why ? sig.why(b.worst) : "погано";
      const share = b.total > 1 ? ` · погано в ${b.bad} з ${b.total} проб` : "";
      fails.push({ t, detail: `${b.bad > 1 && sig.rank ? "найгірше: " : ""}${what}${share}` });
    }
  }
  return { from, step, line, fails, seen: buckets.size > 0 };
}

// Порядок карток метрик: спершу те, про що питають найчастіше, далі решта
// за абеткою. Ключ, якого тут немає, не зникає — просто йде в кінець.
const ORDER = [
  "monitor_on", "monitor_src", "monitor_woke", "video_ok", "kiosk_fps", "release",
  "uplink", "wifi_dbm", "ping_ms", "jitter_ms", "loss_pct", "upload_kb_s", "upload_limit_kb_s", "upload_ok", "upload_at", "upload_queue", "upload_oldest", "temp_c", "cpu",
  "mem_used_mb", "mem_total_mb", "disk_free_mb", "root_ro", "usb_ok", "kernel_errors", "uptime_s", "kiosk_frames",
];

// Спільний порядок ключів: спершу знайомі (ORDER), далі за абеткою.
const byOrder = (a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

// Джерела проб: кавомашина окремо, решта (малина, камера) — «залізо точки».
const isJet = (r) => r.source === "jetinno";

// Кольорова крапка стану: зелена — добре, червона — погано, сіра — судити
// нема з чого або показник просто довідковий.
function Dot({ ok }) {
  const tone = ok === null || ok === undefined ? "var(--muted)" : ok ? "var(--ok)" : "var(--bad)";
  return <i style={{ width: 7, height: 7, borderRadius: "50%", background: tone, display: "inline-block", flex: "none" }} />;
}

// Крапки біля метрик малини (прохання власника 12.10.2026, «як у Jetinno»).
// Правила — ті самі, що в смужок «Показники Raspberry» (SIGNALS), щоб
// крапка й смужка над нею не сперечались; місце на картці й памʼять — за
// порогами алертів overseer (backend/overseer/src/checks.js). Решта полів —
// довідка (реліз, аптайм, пінг), їм сіра крапка.
const PI_SIGNAL = {
  monitor_on: "monitor", kiosk_fps: "kiosk", root_ro: "card",
  usb_ok: "usb", loss_pct: "net", video_ok: "video", temp_c: "temp",
};
const PI_EXTRA = {
  upload_ok: (m) => (m.upload_ok === undefined || m.upload_ok === null ? null : m.upload_ok),
  disk_free_mb: (m) => (Number.isFinite(m.disk_free_mb) ? m.disk_free_mb >= 300 : null),
  mem_used_mb: (m) => (Number.isFinite(m.mem_used_mb) && m.mem_total_mb > 0
    ? m.mem_used_mb / m.mem_total_mb <= 0.92 : null),
  // Будь-яка помилка ядра з увімкнення — уже привід глянути список нижче.
  kernel_errors: (m) => (Number.isFinite(m.kernel_errors) ? m.kernel_errors === 0 : null),
};
function piOk(key, metrics) {
  const sig = SIGNALS.find((x) => x.key === PI_SIGNAL[key]);
  if (sig) return sig.pick(metrics);
  return PI_EXTRA[key]?.(metrics) ?? null;
}

// Рядок підсумку кавомашини: кольорова крапка (ok/погано/нейтрально),
// значення й необов'язковий підпис.
function JetRow({ label, ok, value, sub }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", fontSize: 11.5, gap: 8 }}>
      <span className="row" style={{ gap: 6 }}><Dot ok={ok} />{label}</span>
      <span style={{ textAlign: "right" }}><b>{value}</b>{sub ? <span className="muted" style={{ marginLeft: 6 }}>{sub}</span> : null}</span>
    </div>
  );
}

// Рядок спільної шкали часу (власник, 16.10.2026): ліворуч назва й, де
// значення неочевидне, сірий підпис під нею; праворуч полотно — смужка чи
// графік. Колонка назви однієї ширини в усіх картках (--tl-name, theme.css),
// тож полотна починаються й закінчуються на одних вертикалях, а з тим самим
// domain — це й однакові години: червоне відро над стрибком пінгу видно
// одразу, без звіряння дат.
const TlRow = ({ name, note = null, chart = false, children }) => (
  <div className={`tl-row${chart ? " tl-chart" : ""}`}>
    <span className="tl-name">{name}{note && <small>{note}</small>}</span>
    <div className="tl-body">{children}</div>
  </div>
);
const TlEmpty = ({ children }) => <div className="tl-empty">{children}</div>;

// Помилки ядра малини (pitelemetry.c, 17.10.2026): кожна пачка — рядки, що
// прийшли однією пробою, щойно ядро їх написало, — тобто й тоді, коли далі
// малина вже не змогла нічого. Червоні — рівень err і вище. count — з
// останньої проби малини: undefined — реліз ще без цього, null — лог ядра
// малині не читається.
const upFor = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} хв` : human("uptime_s", s));
function KernelErrors({ events, count, span }) {
  const say = (text) => <span className="muted" style={{ fontSize: 11.5 }}>{text}</span>;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <b style={{ fontSize: 12 }}>Помилки ядра</b>
        {Number.isFinite(count) && <span className="muted" style={{ fontSize: 10.5 }}>з увімкнення: {fmt.int(count)}</span>}
      </div>
      {events.length ? (
        <div className="kernel-list">
          {events.map((e) => (
            <div key={`${e.measured_at}:${e.metrics?.lines?.[0]?.seq}`} className="kernel-batch">
              <span className="muted">
                {fmt.time(e.measured_at)}
                {Number.isFinite(e.metrics?.uptime_s) ? `, на ${upFor(e.metrics.uptime_s)} роботи` : ""}
                {e.metrics?.dropped ? `, ще ${e.metrics.dropped} не влізло` : ""}
              </span>
              {(e.metrics?.lines ?? []).map((l) => <code key={l.seq} className={l.lvl <= 3 ? "bad" : ""}>{l.msg}</code>)}
            </div>
          ))}
        </div>
      ) : count === undefined ? say("реліз малини ще не стежить за ядром")
        : count === null ? say("малині не читається лог ядра (/dev/kmsg)")
        : say(`${span} не було`)}
    </div>
  );
}

// Сирі проби одного джерела — сторінками з api (admin-ops.js, /samples).
// Колонки — ключі, що прийшли на цій сторінці, у порядку карток точки.
function Samples({ id, range, source, span }) {
  const [page, setPage] = usePage(id, range, source);
  const { data, loading } = useData(() => api.pointSamples(id, { source, range, page }), [id, range, source, page]);
  const rows = data?.rows ?? [];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics ?? {})))].sort(byOrder);
  return (
    <Table
      scroll
      columns={[
        { key: "measured_at", title: "коли", render: (r) => fmt.time(r.measured_at) },
        ...keys.map((k) => ({
          key: `m:${k}`, title: LABELS[k] ?? k,
          render: (r) => (r.metrics?.[k] === undefined || r.metrics?.[k] === null ? <span className="muted">—</span> : human(k, r.metrics[k])),
        })),
      ]}
      rows={rows}
      empty={!data ? "вантажимо…" : source === "jetinno" ? `проб з порталу ${span} немає` : `телеметрії ${span} немає`}
      foot={<Pager info={data?.page} onPage={setPage} busy={loading}
                   note={source === "jetinno" ? "з порталу Jetinno, раз на пів години" : "як їх надіслала точка, свіжі зверху"} />}
    />
  );
}

export function Pos({ id }) {
  const [range, setRange] = useRange();
  // Таб таблиці проб — хук мусить стояти тут, над ранніми return:
  // інакше на «вантажимо…» він не викликається, а після приходу даних
  // викликається, і React падає на зміні кількості хуків (11.10.2026).
  const [tab, setTab] = useState("pi");
  const [pausing, setPausing] = useState(false);
  const { data, error, loading, reload } = useData(() => api.point(id, range), [id, range]);

  if (loading && !data) return <Empty>вантажимо…</Empty>;
  if (error) return <Empty>{error.status === 404 ? "немає такої точки" : `не вдалось прочитати: ${error.message}`}</Empty>;

  const { point, latest, history, health, uptime, receipts } = data;
  const kernel = data.kernel ?? [];
  // Пауза заливки відео (власник, 17.10.2026): запис на точці йде далі,
  // сегменти чекають на флешці, а знята пауза — малина доганяє сама.
  const paused = point.video_upload_paused_at;
  const togglePause = async () => {
    setPausing(true);
    try {
      await api.pointVideoUpload(point.id, !paused);
      await reload();
    } finally {
      setPausing(false);
    }
  };
  const win = data.window ?? { hours: 168, step: 30 * 60_000 };
  const span = `за ${rangeLabel(range) === "доба" ? "добу" : rangeLabel(range)}`;
  const stepText = (ms) => (ms >= 3600_000 ? `${ms / 3600_000} год` : `${ms / 60_000} хв`);
  // Кавомашина є не на кожній точці: без неї й без її проб блоки Jetinno —
  // лише порожні рядки «проб немає» (16.10.2026).
  const hasJet = Boolean(point.has_jetinno) || latest.some(isJet);
  const source = hasJet ? tab : "pi";

  // Історія приходить спільною для всіх джерел, тож смужки рахуємо кожна за
  // своїм: інакше проби кавомашини потрапляли б у відра малини й навпаки.
  // Проріджування на місяці групує по джерелах (api/admin-ops.js, thin), тож
  // `source` тут є на будь-якому періоді.
  const piHistory = history.filter((h) => !isJet(h));
  const jetHistory = history.filter(isJet);
  // Відра машини — завширшки з її справжній інтервал опитування, а не з крок
  // вікна (власник, 12.10.2026): медіана проміжків, округлена до кроку вікна.
  const jetWin = (() => {
    const ts = jetHistory.map((h) => new Date(h.measured_at).getTime()).sort((a, b) => a - b);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0).sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return { ...win, step: Math.max(win.step, Math.round(median / win.step) * win.step) };
  })();
  const jetSeries = JET_SIGNALS.map((sig) => ({ sig, series: boolSeries(jetHistory, sig, jetWin) }));
  const pi = latest.find((l) => l.source === "pi");
  const jet = latest.find((l) => l.source === "jetinno");
  const series = (key) => history
    .filter((h) => !isJet(h) && h.metrics && h.metrics[key] !== undefined && h.metrics[key] !== null)
    .map((h) => ({ x: h.measured_at, y: Number(h.metrics[key]) }));

  // Спільне вікно смужок і графіків — рівно відра boolSeries: від першого
  // відра до кінця поточного. Смужки й лінії малюються в ньому за часом.
  const last = Math.floor(Date.now() / win.step) * win.step;
  const domain = [last - win.hours * 3600_000, last + win.step];

  const ping = series("ping_ms");
  const jitter = series("jitter_ms");
  const loss = series("loss_pct");
  // Сигнал Wi-Fi: нижче −90 дБм зв'язку однаково немає — притискаємо до низу.
  const wifi = series("wifi_dbm").map((p) => ({ ...p, y: Math.max(-90, p.y) }));
  // Заливка вгору: точка — одна на заливку, за її власним часом (upload_at),
  // бо телеметрія щохвилини повторює ОСТАННІЙ замір (stack/uploader.sh).
  const uploads = [...new Map(history
    .filter((h) => h.metrics?.upload_at && h.metrics.upload_kb_s !== undefined && h.metrics.upload_kb_s !== null)
    .map((h) => [h.metrics.upload_at, h.metrics])).values()]
    .sort((a, b) => new Date(a.upload_at) - new Date(b.upload_at));
  const upload = uploads.map((m) => ({ x: m.upload_at, y: Number(m.upload_kb_s) }));
  const uploadCap = uploads.filter((m) => m.upload_limit_kb_s != null)
    .map((m) => ({ x: m.upload_at, y: Number(m.upload_limit_kb_s) }));

  return (
    <>
      <div className="head">
        <div>
          <h1>{point.name}</h1>
          <p>
            {point.id}, {point.short_address ?? point.address ?? "адреси немає"}.{" "}
            {point.last_seen_at ? `Озивалась ${fmt.ago(point.last_seen_at)}` : "Не озивалась жодного разу"}
          </p>
        </div>
        <div className="right">
          <RangePicker value={range} onChange={setRange} />
          <button className="btn" disabled={pausing} onClick={togglePause}
                  title={paused ? "заливка відео стоїть — відновити" : "зупинити заливку відео, запис іде далі"}>
            {paused ? "▶ відновити заливку" : "⏸ пауза заливки"}
          </button>
          <button className="btn" onClick={() => go("health")}>← до здоровʼя</button>
          <span className="env"><i style={{ background: point.last_seen_at ? "var(--ok)" : "var(--bad)" }} />{point.status}</span>
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi
          label={`Аптайм ${span}`}
          value={uptime === null ? "—" : `${(uptime * 100).toFixed(1)}%`}
          tone={uptime === null ? "" : uptime > 0.99 ? "ok" : "bad"}
          note={uptime === null ? "проб ще не було" : "за пробами overseer"}
        />
        <Kpi label="Ключ точки" value={point.has_key ? "є" : "немає"} tone={point.has_key ? "ok" : "bad"}
             note={point.key_revoked_at ? "відкликаний" : point.has_key ? "кіоск може брати токен" : "кіоск працює без токена"} />
        <Kpi label="Чеків за добу" value={fmt.int(receipts.day)} note={receipts.last ? `останній ${fmt.ago(receipts.last)}` : "чеків не було"} />
        <Kpi label="Телеметрія" value={pi ? fmt.ago(pi.measured_at) : "—"} tone={pi ? "" : "bad"}
             note={pi ? "остання проба з малини" : "малина ще нічого не слала"} />
      </div>

      {/* Компоненти — ліворуч і в одну колонку, а праворуч — усе, що має
          історію, на спільній шкалі часу на всю ширину (власник, 16.10.2026). */}
      <div className="pos-layout">
        <div className="pos-main">
          {/* Те саме, що смужки малини, з проб кавомашини (11.10.2026): коли
              вона відвалювалась, коли висіла несправність, коли розʼїхались
              замовлення з чеками. Відра — її власного кроку, на тій самій осі.
              Стоїть першою, над Raspberry (власник, 16.10.2026). */}
          {hasJet && (
            <Card title="Кавомашина (Jetinno)" note={`${span}, відра по ${stepText(jetWin.step)}`}>
              {jetSeries.map(({ sig, series: sr }) => (
                <TlRow key={sig.key} name={sig.name} note={sr.seen ? sig.note : "проб немає"}>
                  <Beat history={sr} domain={domain} />
                </TlRow>
              ))}
              <TimeScale domain={domain} />
            </Card>
          )}

          {/* Історія булевих показників — тут, а не на дашборді здоровʼя: там
              потрібна одна відповідь «усе гаразд / ні», а «коли саме гасився
              екран минулої середи» дивляться вже прицільно, на точці
              (прохання власника 24.09.2026). У відрі досить однієї поганої
              проби, щоб воно стало червоним, — поломку так не проґавиш. */}
          <Card title="Raspberry" note={`${span}, відра по ${stepText(win.step)}`}>
            <TlRow name="точка на звʼязку" note="проби overseer"><Beat history={health} domain={domain} /></TlRow>
            {SIGNALS.map((s) => {
              const sr = boolSeries(piHistory, s, win);
              return (
                <TlRow key={s.key} name={s.name} note={sr.seen ? s.note : "проб немає"}>
                  <Beat history={sr} domain={domain} />
                </TlRow>
              );
            })}
            <TimeScale domain={domain} />
          </Card>

          {/* Мережа точки (власник, 12.10.2026): пінг каже, чи є інтернет,
              а заливка — скільки він тягне вгору. Окремими графіками, бо
              мілісекунди, відсотки й КБ/с на одній осі не живуть. */}
          <Card title="Мережа" note={pi?.metrics?.uplink
            ? `зараз через ${UPLINK[pi.metrics.uplink] ?? pi.metrics.uplink}${Number.isFinite(pi.metrics.wifi_dbm) ? `, сигнал ${pi.metrics.wifi_dbm} дБм` : ""}`
            : span}>
            <TlRow chart name="пінг і jitter, мс" note="до api.extrovert.cafe">
              {ping.length || jitter.length ? (
                <Line flush domain={domain} height={96} format={(v) => v.toFixed(0)} series={[
                  ...(ping.length ? [{ name: "пінг, мс", color: "#FE810B", points: ping }] : []),
                  ...(jitter.length ? [{ name: "jitter, мс", color: "#3FBF6F", points: jitter }] : []),
                ]} />
              ) : <TlEmpty>малина ще не слала мережевих метрик</TlEmpty>}
            </TlRow>
            {/* Пакетів у пробі п'ять, тож значення сходинками: один загублений —
                16–17 %, два — 28 %. Сіра лінія — поріг червоного (LOSS_BAD_PCT). */}
            <TlRow chart name="втрати пінгу, %" note="5 пакетів щохвилини">
              {loss.length ? (
                <Line flush domain={domain} height={80} max={100} format={(v) => v.toFixed(0)} series={[
                  { name: "втрати, %", color: "#FF6B7A", points: loss },
                  { name: `поріг ${LOSS_BAD_PCT} %`, color: "#8B94A3", points: [{ x: domain[0], y: LOSS_BAD_PCT }, { x: domain[1], y: LOSS_BAD_PCT }] },
                ]} />
              ) : <TlEmpty>малина ще не слала втрат</TlEmpty>}
            </TlRow>
            {/* Сигнал Wi-Fi — лише там, де малина ходить через Wi-Fi. */}
            {wifi.length > 0 && (
              <TlRow chart name="сигнал Wi-Fi, дБм" note="−50 добре, −70 межа, −80 погано">
                <Line flush domain={domain} height={80} min={-90} max={-30} legend={false} format={(v) => v.toFixed(0)}
                      series={[{ name: "сигнал Wi-Fi, дБм", color: "#5AA9FF", points: wifi }]} />
              </TlRow>
            )}
            <TlRow chart name="заливка відео, КБ/с"
                   note={paused ? <Badge tone="warn">на паузі з {fmt.time(paused)}</Badge>
                     : Number.isFinite(pi?.metrics?.upload_queue)
                     ? (pi.metrics.upload_queue ? `у черзі ${fmt.int(pi.metrics.upload_queue)} сегм.` : "черга порожня")
                     : "точка на кожну заливку"}>
              {upload.length ? (
                <Line flush domain={domain} height={96} format={(v) => v.toFixed(0)} series={[
                  { name: "швидкість, КБ/с", color: "#5AA9FF", points: upload },
                  ...(uploadCap.length ? [{ name: "стеля, КБ/с", color: "#8B94A3", points: uploadCap }] : []),
                ]} />
              ) : <TlEmpty>замірів заливки ще не було</TlEmpty>}
            </TlRow>
            <TimeScale domain={domain} />
          </Card>

          {/* Кожен показник — своя вісь: памʼять міряється сотнями МБ, диск —
              тисячами, fps — десятками; на спільній шкалі диск притиснув би
              решту до нуля, і перегрів виглядав би як норма. */}
          <Card title="Залізо" note={`${span}, за часом виміру`}>
            {HARDWARE.map((h) => {
              const points = series(h.key);
              return (
                <TlRow chart key={h.key} name={h.name}>
                  {points.length
                    ? <Line flush domain={domain} height={72} legend={false} format={h.format}
                            series={[{ name: h.name, color: h.color, points }]} />
                    : <TlEmpty>проб немає</TlEmpty>}
                </TlRow>
              );
            })}
            <TimeScale domain={domain} />
          </Card>
        </div>

        <Card title="Компоненти точки" note="остання проба" className="pos-side">
          {latest.length === 0 ? (
            <Empty>телеметрії ще не було</Empty>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {latest.filter((l) => !isJet(l)).map((l) => (
                <div key={l.source}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <b style={{ fontSize: 12 }}>{l.source === "pi" ? "Raspberry Pi" : "Камера"}</b>
                    <span className="muted" style={{ fontSize: 10.5 }}>{fmt.ago(l.measured_at)}</span>
                  </div>
                  {/* Усі метрики, а не перші дванадцять: 24.09.2026 обрізання
                      сховало саме monitor_on — те, заради чого сюди й заходять. */}
                  <div className="metric-list">
                    {Object.entries(l.metrics ?? {})
                      .sort(([a], [b]) => byOrder(a, b))
                      .map(([k, v]) => (
                        <div key={k} className="metric">
                          <span className="row muted" style={{ gap: 6 }}><Dot ok={piOk(k, l.metrics)} />{LABELS[k] ?? k}</span>
                          <b>{human(k, v)}</b>
                        </div>
                      ))}
                  </div>
                </div>
              ))}

              <KernelErrors events={kernel} count={pi?.metrics?.kernel_errors} span={span} />

              {/* Кавомашина — підсумком з порталу: онлайн, поломки, звірка з
                  чеками. Несправності — зі списку, а не з лічильника get_device:
                  11.10.2026 він показував 0 при відчинених дверцятах. */}
              {hasJet && (
                <div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <b style={{ fontSize: 12 }}>Кавомашина (Jetinno)</b>
                    <span className="muted" style={{ fontSize: 10.5 }}>{jet ? fmt.ago(jet.measured_at) : "проб не було"}</span>
                  </div>
                  {!jet ? (
                    <Empty>телеметрії з порталу ще не було</Empty>
                  ) : jet.metrics?.session === false ? (
                    <JetRow label="сесія порталу" ok={false} value="злетіла — потрібен вхід" />
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      <JetRow label="машина" ok={jet.metrics.online} value={jet.metrics.online ? "онлайн" : "офлайн"}
                              sub={jet.metrics.last_login ? `востаннє ${fmt.ago(jet.metrics.last_login)}` : null} />
                      <JetRow label="несправності" ok={!jet.metrics.fault_codes?.length}
                              value={jet.metrics.fault_codes?.length ? jet.metrics.fault_codes.join("; ") : "немає"} />
                      <JetRow label="попередження" ok={!jet.metrics.warnings}
                              value={jet.metrics.warnings ? String(jet.metrics.warnings) : "немає"} />
                      <JetRow label="дефіцит інгредієнтів" ok={!jet.metrics.supply_short}
                              value={jet.metrics.supply_short ? String(jet.metrics.supply_short) : "немає"} />
                      {jet.metrics.faults_recent_24h?.length ? (
                        <JetRow label="події за добу" ok={false} sub="уже скинуті"
                                value={jet.metrics.faults_recent_24h.join("; ")} />
                      ) : null}
                      <JetRow label="замовлення ↔ чеки за добу" ok={jet.metrics.reconcile_ok}
                              value={`${jet.metrics.orders_card_24h ?? "?"} карткою / ${jet.metrics.receipts_24h ?? "?"} чеків`}
                              sub={jet.metrics.reconcile_ok ? "сходяться" : "розходяться — перевір"} />
                      <JetRow label="готівкою за добу" ok={null} value={String(jet.metrics.orders_cash_24h ?? 0)}
                              sub={jet.metrics.orders_cash_24h ? "готівка теж має фіскалізуватись" : null} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Сирі проби — у підвалі сторінки, табами (набори ключів у малини й
          кавомашини різні, 11.10.2026), і в кожного джерела — своя сторінка:
          досі спільні «останні 50» майже цілком складались із проб малини. */}
      <div className="samples">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <b style={{ fontSize: 12.5 }}>Сирі проби {source === "jetinno" ? "Jetinno" : "Raspberry"} {span}</b>
          {hasJet && (
            <span className="chips">
              <button className={`pill${source === "pi" ? " on" : ""}`} onClick={() => setTab("pi")}>Raspberry</button>
              <button className={`pill${source === "jetinno" ? " on" : ""}`} onClick={() => setTab("jetinno")}>Jetinno</button>
            </span>
          )}
        </div>
        <Samples key={source} id={id} range={range} source={source} span={span} />
      </div>
    </>
  );
}
