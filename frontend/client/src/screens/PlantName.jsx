// «Ім'я кавенятка»: єдине поле й підказка. Ім'я бачить лише власник, тому
// перевірок тут мінімум — на відміну від нікнейма, який унікальний.
import { useState } from "react";
import { api } from "../api.js";

const SUGGESTIONS = ["Барні", "Еспі", "Мокко", "Крема", "Роба"];

export function PlantName({ plant, ctx }) {
  const [name, setName] = useState(plant?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/me/plants/${plant.id}`, { name: name.trim() });
      ctx.pop();
    } catch (e) {
      setError(e.body?.error === "empty_name" ? "Імʼя не може бути порожнім" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <div className="panel">
        <input className="price-input" style={{ width: "100%", fontSize: 18 }} value={name}
               placeholder="Як його звати?" maxLength={24}
               onChange={(e) => setName(e.target.value.slice(0, 24))} />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} className="btn" style={{ width: "auto", height: 34, padding: "0 14px", fontSize: 13 }}
                  onClick={() => setName(s)}>{s}</button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Імʼя бачиш ти й саме кавенятко. Якщо колись продаси його на маркеті — поїде разом із ним.
      </p>
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
      <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>Зберегти</button>
    </div>
  );
}
