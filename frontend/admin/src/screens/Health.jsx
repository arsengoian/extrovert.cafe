// Дашборд здоровʼя — екран за замовчуванням (docs/admin_panel.md).
//
// Проби збирає overseer півгодинними відрами в health_samples; тут ми їх
// лише малюємо. Смужка — тиждень: 336 відер, зелене/червоне/сіре, а деталі
// падіння — у підказці на комірці.
import { Fragment } from "react";
import { api } from "../api.js";
import { go } from "../app.jsx";
import { Beat, BeatRow, BeatScale } from "../charts.jsx";
import { Card, Empty, Kpi, METRIC_LABELS, fmt, metricValue, useData } from "../ui.jsx";

const score = (s) => (s ? `${s.ok} / ${s.total}` : "—");
const tone = (s) => (!s ? "" : s.ok === s.total ? "ok" : s.total - s.ok > 1 ? "bad" : "");
const first = (s) => (s?.bad?.length ? s.bad[0] : "усе відповідає");

// Телеметрія точки числами. Смужка overseer каже, КОЛИ ставало погано;
// ці рядки кажуть, ЯК зараз — щоб не йти по це на сторінку точки
// (docs/admin_panel.md, «телеметрія кожної POS»).
const num = (v, digits = 0) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v).toFixed(digits);
const bits = (...parts) => parts.filter(Boolean).join(" · ") || null;

// Один рядок даних під точкою. Смужки тут немає навмисно: історію цих
// чисел малює сторінка точки, а тут потрібне саме поточне значення.
const DataRow = ({ label, ok, value, at }) => (
  <div className="beat-row sub">
    <span className="name" style={{ width: 220 }}>
      <i className={`dot ${ok === null || ok === undefined ? "" : ok ? "ok" : "bad"}`} />
      <span className="muted">{label}</span>
    </span>
    <span className="value" style={{ marginLeft: 0, flex: 1, textAlign: "left" }}>
      {value ?? "немає даних"}
      {/* Свіжість проби ховається, поки вона свіжа: інакше кожен рядок
          тягнув би за собою «2 хв тому» і числа тонули б у датах. */}
      {at && Date.now() - new Date(at).getTime() > 15 * 60_000 && (
        <span className="muted"> · проба {fmt.ago(at)}</span>
      )}
    </span>
  </div>
);

function PointTelemetry({ point }) {
  const pi = point.telemetry?.pi;
  const m = pi?.metrics ?? {};
  const at = pi?.measured_at ?? null;
  const jet = point.telemetry?.jetinno;

  const loss = num(m.loss_pct);
  const disk = num(m.disk_free_mb) === null ? null : (Number(m.disk_free_mb) / 1024).toFixed(1);
  const fps = num(m.kiosk_fps);

  // Малина шле пробу раз на пʼять хвилин. Протухла проба лишається на
  // екрані — вона все одно остання, що ми знаємо, — але крапка біля неї
  // гасне: зелене «втрати 0 %» годинної давнини гірше за відверте «не знаю».
  const fresh = at !== null && Date.now() - new Date(at).getTime() < 15 * 60_000;
  const dot = (value) => (fresh ? value : null);

  return (
    <>
      {/* Інтернет — не те саме, що «точка озивається»: проба з чергою
          доїжджає й після обриву, а ping із втратами показує зв'язок, який
          ще живий, але вже поганий. */}
      <DataRow
        label="інтернет"
        ok={dot(loss === null ? null : Number(loss) < 5)}
        at={at}
        value={bits(
          num(m.ping_ms) && `ping ${num(m.ping_ms)} мс`,
          num(m.jitter_ms) && `jitter ${num(m.jitter_ms)} мс`,
          loss !== null && `втрати ${loss} %`
        )}
      />
      {/* Зв'язок — це лише про малину. Монітор і відеопотік ідуть окремими
          смужками: вимкнений екран чи мертвий потік із «точка озивається»
          не видно (23.09.2026). */}
      {[["монітор", point.monitor], ["відеопотік", point.video]].map(([label, s]) => s && (
        <div key={label} className="beat-row sub">
          <span className="name" style={{ width: 220 }}>
            <i className={`dot ${s.ok ? "ok" : "bad"}`} />
            <span className="muted">{label}</span>
          </span>
          <span className="value" style={{ marginLeft: 0, width: 150, textAlign: "left" }}>{s.detail ?? "працює"}</span>
          <Beat history={s.history} />
        </div>
      ))}
      <DataRow
        label="залізо"
        // Пороги грубі навмисно: 80 °C — throttling малини, менше гігабайта
        // вільного — місце під релізи й чергу телеметрії.
        ok={dot(num(m.temp_c) === null ? null : Number(m.temp_c) < 80 && Number(m.disk_free_mb ?? 9e9) > 1024)}
        at={at}
        value={bits(
          num(m.temp_c, 1) && `${num(m.temp_c, 1)} °C`,
          num(m.cpu) && `CPU ${num(m.cpu)} %`,
          num(m.mem_used_mb) && `памʼять ${num(m.mem_used_mb)} МБ`,
          disk && `диск ${disk} ГБ`
        )}
      />
      <DataRow
        label="кіоск"
        ok={dot(fps === null ? null : Number(fps) > 0)}
        at={at}
        value={bits(fps !== null && `${fps} fps`, m.release && `реліз ${m.release}`)}
      />
      <DataRow
        label="автомат"
        ok={jet ? true : null}
        at={jet?.measured_at ?? null}
        // Ключів автомата ми ще не бачили жодного разу — показуємо як є,
        // а підписи зʼявляться в METRIC_LABELS, коли стане видно, що він шле.
        value={jet
          ? Object.entries(jet.metrics ?? {}).slice(0, 6)
              .map(([k, v]) => `${METRIC_LABELS[k] ?? k}: ${metricValue(k, v)}`).join(" · ")
          : "телеметрії ще немає"}
      />
    </>
  );
}

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
              {/* Усе в цій картці вирівняне ліворуч від однієї межі: під
                  точкою йдуть рядки з числами, і колонка, вирівняна
                  праворуч, розбивала б їх на дві сходинки. */}
              <span className="value" style={{ marginLeft: 0, width: 150, textAlign: "left" }}>
                {p.last_seen_at ? `озивалась ${fmt.ago(p.last_seen_at)}` : "не озивалась жодного разу"}
              </span>
              <Beat history={p.history} />
            </div>
            <PointTelemetry point={p} />
            </Fragment>
          ))
        )}
      </Card>
    </>
  );
}
