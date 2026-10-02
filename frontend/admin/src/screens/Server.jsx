// Розділ «Сервер» на дашборді здоровʼя (docs/admin_panel.md): процесор,
// памʼять, диск, бази й контейнери дроплета. Смужки вище кажуть, чи
// сервіси живі; тут — чи не впираються вони в залізо, і як давно до цього
// йде. Дані збирає overseer раз на дві хвилини (overseer/src/server.js).
//
// Окремий запит, а не частина /admin/health: таблиця смужок не має чекати
// агрегацій за місяць, а розділ сервера — падати разом із нею.
import { api } from "../api.js";
import { Line } from "../charts.jsx";
import { Badge, Card, Empty, Kpi, Table, fmt, useData } from "../ui.jsx";

const COLORS = ["#FE810B", "#5AA9FF", "#B07CFF", "#3FBF6F", "#FFB020", "#FF2D6F", "#8B94A3", "#2EC4B6", "#E07A5F", "#9BC53D", "#C77DFF", "#F2CC8F"];
const LIMIT = "#FF5F57";

const bytes = (n) => {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1).replace(".", ",")} ГБ`;
  if (v >= 1024 ** 2) return `${Math.round(v / 1024 ** 2)} МБ`;
  return `${Math.round(v / 1024)} КБ`;
};
const pctOf = (a, b) => (a === null || a === undefined || !b ? null : (100 * Number(a)) / Number(b));
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);
// Тон KPI: червоний — за порогом алерту overseer, жовтий (звичайний колір
// KPI) — від 70 % до порогу, зелений — нижче: запас є.
const tone = (v, limit) => (v === null ? "" : v >= limit.high ? "bad" : v < 70 ? "ok" : "");

function uptime(since) {
  if (!since) return "—";
  const s = (Date.now() - new Date(since).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} хв`;
  if (s < 86400) return `${Math.round(s / 3600)} год`;
  return `${Math.round(s / 86400)} дн`;
}

// Поріг алерту — тонкою червоною лінією на всю ширину: видно, скільки
// лишалось до стелі, а не лише саму криву.
const limitLine = (domain, value) => ({ name: `поріг алерту ${value}%`, color: LIMIT, points: [{ x: domain[0], y: value }, { x: domain[1], y: value }] });

export function ServerSection({ range, span }) {
  const { data, error, loading } = useData(() => api.server(range), [range]);

  if (loading && !data) return <Card title="Сервер"><Empty>вантажимо…</Empty></Card>;
  if (error) return <Card title="Сервер"><Empty>не вдалось прочитати телеметрію сервера: {error.message}</Empty></Card>;

  const { latest, limits, series, window: win } = data;
  const now = Date.now();
  const domain = [now - win.hours * 3600_000, now];
  const at = (r) => new Date(r.t).getTime();
  const pick = (f) => series.filter((r) => f(r) !== null && f(r) !== undefined).map((r) => ({ x: at(r), y: f(r) }));

  if (!latest) return <Card title="Сервер"><Empty>проб ще не було: їх збирає overseer раз на дві хвилини</Empty></Card>;

  const cpu = latest.cpu === null ? null : Number(latest.cpu);
  const mem = pctOf(latest.mem_used, latest.mem_total);
  const disk = pctOf(latest.disk_used, latest.disk_total);
  const dbs = Object.entries(latest.databases ?? {}).sort((a, b) => b[1] - a[1]);
  const ours = latest.databases?.[latest.db];
  const others = dbs.filter(([name]) => name !== latest.db);

  // Ряди по сервісу й по базі: одна лінія на кожен.
  const groups = (rows, key, value) => {
    const by = new Map();
    for (const r of rows) {
      if (r[value] === null || r[value] === undefined) continue;
      if (!by.has(r[key])) by.set(r[key], []);
      by.get(r[key]).push({ x: at(r), y: Number(r[value]) });
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const serviceNames = [...new Set(data.services.map((r) => r.service))].sort();
  const colorOf = (name) => COLORS[serviceNames.indexOf(name) % COLORS.length];
  const svcMem = groups(data.services, "service", "mem").map(([name, points]) => ({ name, color: colorOf(name), points }));
  const svcCpu = groups(data.services, "service", "cpu").map(([name, points]) => ({ name, color: colorOf(name), points }));
  const dbSeries = groups(data.databases, "name", "bytes")
    .map(([name, points], i) => ({ name, color: COLORS[i % COLORS.length], points }));
  const redisPoints = pick((r) => (r.redis_bytes === null ? null : Number(r.redis_bytes)));

  // Те, що потребує уваги (не працює, нездоровий), — нагору.
  const trouble = (c) => (c.state !== "running" || (c.health && c.health !== "healthy") ? 0 : 1);
  const containers = data.containers ? [...data.containers.list].sort((a, b) => trouble(a) - trouble(b)) : null;
  const stepNote = `${span}, крок ${win.step >= 3600_000 ? `${win.step / 3600_000} год` : `${win.step / 60_000} хв`}`;

  return (
    <>
      <h2 className="section-title">Сервер</h2>
      <div className="grid k4">
        <Kpi label="Процесор" value={pct(cpu)} tone={tone(cpu, limits.cpu)}
             note={`за останні 2 хв · load ${latest.load1 === null ? "—" : Number(latest.load1).toFixed(2).replace(".", ",")} на ${latest.cpus ?? "?"} ${fmt.plural(latest.cpus ?? 0, "ядро", "ядра", "ядер")}`} />
        <Kpi label="Памʼять" value={pct(mem)} tone={tone(mem, limits.mem)}
             note={`${bytes(latest.mem_used)} з ${bytes(latest.mem_total)}${Number(latest.swap_used) > 0 ? ` · swap ${bytes(latest.swap_used)}` : ""}`} />
        <Kpi label="Диск" value={pct(disk)} tone={tone(disk, limits.disk)}
             note={`вільно ${bytes(Number(latest.disk_total) - Number(latest.disk_used))} з ${bytes(latest.disk_total)}`} />
        <Kpi label="База" value={bytes(ours)}
             note={[...others.map(([name, n]) => `${name} ${bytes(n)}`), `redis ${bytes(latest.redis_bytes)}`].join(" · ")} />
      </div>

      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Процесор" note={stepNote}>
          <Line domain={domain} max={100} format={(v) => `${Math.round(v)}%`} series={[
            { name: "середнє", color: "#FE810B", points: pick((r) => r.cpu) },
            { name: "пік у кроці", color: "#5AA9FF", points: pick((r) => r.cpu_max) },
            limitLine(domain, limits.cpu.high),
          ]} />
        </Card>
        <Card title="Памʼять" note={`${stepNote}, без кешу ядра`}>
          <Line domain={domain} max={100} format={(v) => `${Math.round(v)}%`} series={[
            { name: "зайнято", color: "#FE810B", points: pick((r) => pctOf(r.mem_used, r.mem_total)) },
            ...(series.some((r) => Number(r.swap_used) > 0) ? [{ name: "swap, % від памʼяті", color: "#B07CFF", points: pick((r) => pctOf(r.swap_used, r.mem_total)) }] : []),
            limitLine(domain, limits.mem.high),
          ]} />
        </Card>
      </div>

      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Диск" note={span}>
          <Line domain={domain} max={100} format={(v) => `${Math.round(v)}%`} series={[
            { name: "зайнято", color: "#FE810B", points: pick((r) => pctOf(r.disk_used, r.disk_total)) },
            limitLine(domain, limits.disk.high),
          ]} />
        </Card>
        <Card title="Бази й Redis" note={span}>
          <Line domain={domain} format={bytes} series={[
            ...dbSeries,
            ...(redisPoints.length ? [{ name: "redis", color: "#FF2D6F", points: redisPoints }] : []),
          ]} />
        </Card>
      </div>

      <div className="grid k2" style={{ marginTop: 12 }}>
        <Card title="Памʼять контейнерів" note={stepNote}>
          <Line domain={domain} format={bytes} series={svcMem} />
        </Card>
        <Card title="Процесор контейнерів" note={`${stepNote}, % від ядра`}>
          <Line domain={domain} format={(v) => `${Math.round(v)}%`} series={svcCpu} />
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Контейнери" note={data.containers?.at ? `стан ${fmt.ago(data.containers.at)}` : null}>
          {containers === null ? (
            <Empty>docker-proxy не відповідає — таблиці контейнерів немає (локально так і має бути)</Empty>
          ) : (
            <Table rows={containers} columns={[
              { key: "name", title: "Контейнер", render: (c) => <span>{c.service}<small className="muted" style={{ display: "block" }}>{c.name}</small></span> },
              { key: "state", title: "Стан", render: (c) => {
                const ok = c.state === "running" && (c.health === null || c.health === "healthy");
                return <Badge tone={ok ? "ok" : c.state === "running" ? "warn" : "bad"}>{c.health ? `${c.state}, ${c.health}` : c.state}</Badge>;
              } },
              { key: "uptime", title: "Працює", num: true, render: (c) => (c.state === "running" ? uptime(c.started_at) : "—") },
              { key: "restarts", title: "Перезапуски", num: true, render: (c) => (c.restarts ? <span style={{ color: "var(--bad)" }}>{c.restarts}{c.oom ? " · OOM" : ""}</span> : "0") },
              { key: "cpu", title: "CPU", num: true, render: (c) => (c.cpu === null ? "—" : `${c.cpu.toLocaleString("uk-UA")}%`) },
              { key: "mem", title: "Памʼять", num: true, render: (c) => (c.mem === null ? "—" : `${bytes(c.mem)}${c.limit && c.limit < Number(latest.mem_total) ? ` з ${bytes(c.limit)}` : ""}`) },
              { key: "image", title: "Образ", render: (c) => <span className="muted">{c.image}</span> },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}
