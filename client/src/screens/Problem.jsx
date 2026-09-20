// «Що не працює?» — скарга або ідея. Відкривається з HUD і зі стартового
// екрана, тобто працює і без входу (design: «Проблема»).
import { useEffect, useState } from "react";
import { api } from "../api.js";

const CATEGORIES = [
  { id: "coffee_machine", label: "Кавомашина" },
  { id: "monitor", label: "Монітор" },
  { id: "site", label: "Сайт extrovert.cafe" },
  { id: "supplies", label: "Не вистачає матеріалів" },
  { id: "idea", label: "Хочу запропонувати ідею" },
];

export function Problem({ ctx }) {
  const [point, setPoint] = useState(null);
  const [picked, setPicked] = useState([]);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/points/current").then((r) => setPoint(r.point)).catch(() => {}); }, []);

  const toggle = (id) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/problems", { categories: picked, body, point_id: point?.id ?? null });
      setSent(true);
    } catch (e) {
      setError(e.body?.error === "empty_report" ? "Оберіть, що саме не працює, або опишіть словами" : e.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/cloud.png" alt="" style={{ width: 120, margin: "0 auto 8px" }} />
          <div className="h2">Дякуємо, побачили</div>
          <p className="muted">
            Ми читаємо все, що сюди приходить. Якщо знадобляться деталі — напишемо в підтримку.
          </p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage-pad">
      <div className="panel">
        <div className="muted" style={{ fontSize: 12 }}>Точка</div>
        <div style={{ fontWeight: 700 }}>
          {point ? `${point.name} · ${point.address}` : "—"}
        </div>
      </div>

      <div className="panel">
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Що саме</div>
        {CATEGORIES.map((c) => {
          const on = picked.includes(c.id);
          return (
            <button key={c.id} className="row" style={{ width: "100%", padding: "8px 0", textAlign: "left" }}
                    onClick={() => toggle(c.id)} aria-pressed={on}>
              <span style={{
                width: 22, height: 22, flex: "none", borderRadius: 7,
                border: on ? 0 : "1px solid var(--line)",
                background: on ? "var(--grad)" : "var(--panel2)",
                color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {on ? (
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                       strokeWidth="3.2" strokeLinecap="round"><path d="M5 12.5 10 17.5 19.5 7" /></svg>
                ) : null}
              </span>
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      <div className="panel">
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Деталі</div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Опишіть, що трапилося"
          rows={4}
          style={{
            width: "100%", padding: 12, fontSize: 15, fontFamily: "inherit", resize: "vertical",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--line)",
            background: "var(--panel2)", color: "var(--ink)",
          }}
        />
        <button className="btn" style={{ marginTop: 10 }} disabled
                title="Завантаження фото зʼявиться разом зі сховищем R2">
          Додати фото
        </button>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={send}>
        {busy ? "Надсилаємо…" : "Надіслати"}
      </button>
    </div>
  );
}
