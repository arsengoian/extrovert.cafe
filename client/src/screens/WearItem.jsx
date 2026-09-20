// «Кому вдягнути»: коли кавенят кілька, річ треба спершу адресувати.
// З одним кавенятком екран не показується — Склад веде одразу в гардероб.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";

export function WearItem({ item, ctx }) {
  const [plants, setPlants] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/me/plants").then((r) => setPlants(r.plants)).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!plants) return <div className="stage-pad"><div className="skeleton" /></div>;

  const wear = async (plant) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/me/plants/${plant.id}/wardrobe/${item.slot}`, { user_item_id: item.user_item_id });
      ctx.pop();
      ctx.push("wardrobe", { plant });
    } catch (e) {
      const code = e.body?.error;
      setError(code === "item_locked" ? "Річ замкнена в подарованому комплекті"
        : code === "on_sale" ? "Кавенятко на маркеті — спершу зніми його з продажу"
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        «{item.name}» займе слот {item.slot === "acc_1" ? "аксесуара" : item.slot}. Кому вдягаємо?
      </p>
      {plants.map((plant) => (
        <button key={plant.id} className="panel row" style={{ gap: 12, width: "100%", textAlign: "left" }}
                disabled={busy || plant.on_sale} onClick={() => wear(plant)}>
          <div style={{ width: 64, flex: "none" }}>
            <PlantView plant={plant} width={64} pad={4} platform={false} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>{plant.name || "Без імені"}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              стадія {plant.growth_stage} з 10{plant.on_sale ? " · на маркеті" : ""}
            </div>
          </div>
          <span className="muted">›</span>
        </button>
      ))}
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
    </div>
  );
}
