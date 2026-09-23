// Дашборд здоровʼя — екран за замовчуванням (docs/admin_panel.md).
//
// Проби збирає overseer півгодинними відрами в health_samples; тут ми їх
// лише малюємо. Смужка — тиждень: 336 відер, зелене/червоне/сіре, а деталі
// падіння — у підказці на комірці.
import { Fragment } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Beat, BeatRow, BeatScale } from "../charts.jsx";
import { Card, Empty, Kpi, fmt, useData } from "../ui.jsx";

const score = (s) => (s ? `${s.ok} / ${s.total}` : "—");
const tone = (s) => (!s ? "" : s.ok === s.total ? "ok" : s.total - s.ok > 1 ? "bad" : "");
const first = (s) => (s?.bad?.length ? s.bad[0] : "усе відповідає");

export function Health() {
  const { data, error, loading, reload } = useData(() => api.health());

  if (loading && !data) return <Empty>вантажимо…</Empty>;
  if (error) return <Empty>не вдалось прочитати стан: {error.message}</Empty>;

  const onlinePoints = data.points.filter((p) => p.ok).length;
  const silent = data.points.find((p) => !p.ok);

  return (
    <>
      <div className="head">
        <div>
          <h1>Дашборд здоровʼя</h1>
          <p>
            Оновлено {fmt.ago(data.updated_at)} · історія за 7 днів із кроком 30 хв
            {!data.updated_at && " · проб ще не було: їх збирає overseer"}
          </p>
        </div>
        <div className="right">
          <button className="btn" onClick={reload}>Оновити</button>
          <span className="env"><i />prod</span>
        </div>
      </div>

      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Kpi label="Мікросервіси" value={score(data.score.services)} tone={tone(data.score.services)} note={first(data.score.services)} />
        <Kpi label="Фронтенди" value={score(data.score.frontends)} tone={tone(data.score.frontends)} note={first(data.score.frontends)} />
        <Kpi label="Компоненти" value={score(data.score.components)} tone={tone(data.score.components)} note={first(data.score.components)} />
        <Kpi
          label="POS онлайн"
          value={`${onlinePoints} / ${data.points.length}`}
          tone={data.points.length && onlinePoints === data.points.length ? "ok" : "bad"}
          note={silent ? `${silent.name}: ${silent.detail ?? "мовчить"}` : "усі точки на звʼязку"}
        />
      </div>

      {/* Одна колонка: у дві смужка пульсу стискалась до нечитабельного,
          а поруч із нею ще й назва та затримка. */}
      <div className="stack">
        <Card title="Мікросервіси" note="останні 7 днів">
          {data.services.map((s) => (
            <BeatRow key={s.target} ok={s.ok} name={s.title} note={s.note} history={s.history} ms={s.ms ?? null} value={s.detail ?? s.note} />
          ))}
          <BeatScale history={data.services[0]?.history} />
        </Card>
        <Card title="Фронтенди" note="7 днів · відповідь">
          {data.frontends.map((s) => (
            <BeatRow key={s.target} ok={s.ok} name={s.title} note={s.note} history={s.history} ms={s.ms ?? null} value={s.detail ?? s.note} />
          ))}
          <BeatScale history={data.frontends[0]?.history} />
        </Card>
        <Card title="Компоненти" note="7 днів">
          {data.components.map((s) => (
            <BeatRow key={s.target} ok={s.ok} name={s.title} note={s.note} history={s.history} ms={s.ms ?? null} value={s.detail ?? s.note} />
          ))}
          <BeatScale history={data.components[0]?.history} />
        </Card>
      </div>

      <Card title="Телеметрія POS" note="7 днів · крок 30 хв" className="" style={{ marginTop: 12 }}>
        {data.points.length === 0 ? (
          <Empty>жодної живої точки в базі</Empty>
        ) : (
          data.points.map((p) => (
            <Fragment key={p.id}>
            <div className="beat-row" data-click="1" onClick={() => go(`pos/${p.id}`)} style={{ cursor: "pointer" }}>
              <span className="name" style={{ width: 220 }}>
                <i className={`dot ${p.ok === null ? "" : p.ok ? "ok" : "bad"}`} />
                <span>
                  {p.name}
                  <small className="muted" style={{ display: "block", fontWeight: 400 }}>{p.short_address ?? p.address ?? p.id}</small>
                </span>
              </span>
              <span className="value" style={{ marginLeft: 0, width: 150 }}>
                {p.last_seen_at ? `озивалась ${fmt.ago(p.last_seen_at)}` : "не озивалась жодного разу"}
              </span>
              <Beat history={p.history} />
            </div>
            {/* Зв'язок — це лише про малину. Монітор і відеопотік ідуть
                окремими смужками: вимкнений екран чи мертвий потік із
                «точка озивається» не видно (23.09.2026). */}
            {[["монітор", p.monitor], ["відеопотік", p.video]].map(([label, s]) => s && (
              <div key={label} className="beat-row sub">
                <span className="name" style={{ width: 220 }}>
                  <i className={`dot ${s.ok ? "ok" : "bad"}`} />
                  <span className="muted">{label}</span>
                </span>
                <span className="value" style={{ marginLeft: 0, width: 150 }}>{s.detail ?? "працює"}</span>
                <Beat history={s.history} />
              </div>
            ))}
            </Fragment>
          ))
        )}
      </Card>
    </>
  );
}
