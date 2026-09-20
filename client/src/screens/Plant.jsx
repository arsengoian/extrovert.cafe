// Головний екран: небо, кавенятко, хмаринка з бажанням і поличка з
// препаратами (design: «{{ g.label }}», вкладка plant).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../ui/PlantView.jsx";

const SHELF = [
  { key: "water_liters", title: "Лійка", unit: "л", full: "/assets/ui/bucket.png", empty: "/assets/ui/bucket_empty.png" },
  { key: "fertilizer_kg", title: "Добриво", unit: "кг", full: "/assets/ui/mineral.png", empty: "/assets/ui/mineral_empty.png" },
  { key: "insecticide_bottles", title: "Інсектицид", unit: "шт", full: "/assets/ui/insecticide.png", empty: "/assets/ui/insecticide_empty.png" },
  { key: "compost_kg", title: "Компост", unit: "кг", full: "/assets/ui/compost.png", empty: "/assets/ui/compost_empty.png" },
];

// Що кущ хоче далі — з таблиці переходів (gamification_ui.md): компост на
// 1→3, добриво на 3→7, інсектицид далі. Полив символічний і завжди доречний.
function wishFor(stage) {
  if (stage <= 0) return { need: "compost_kg", label: "компост", icon: "/assets/ui/compost.png" };
  if (stage < 3) return { need: "compost_kg", label: "компост", icon: "/assets/ui/compost.png" };
  if (stage < 7) return { need: "fertilizer_kg", label: "добриво", icon: "/assets/ui/mineral.png" };
  return { need: "insecticide_bottles", label: "інсектицид", icon: "/assets/ui/insecticide.png" };
}

export function Plant({ ctx }) {
  const [plant, setPlant] = useState(null);
  const [error, setError] = useState(null);
  const care = ctx.me?.care ?? {};

  useEffect(() => {
    api.get("/me/plants")
      .then((r) => setPlant(r.plants[0] ?? null))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="stage-pad"><div className="panel">Не вдалось завантажити: {error}</div></div>;
  if (!plant) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/sprout.png" alt="" style={{ width: 48, margin: "8px auto 12px" }} />
          <div className="h2">Кавенятка ще немає</div>
          <p className="muted">Саджанець можна купити в Магазині — за монети або за зерна.</p>
          <button className="btn btn-primary" onClick={() => ctx.openTab("shop")}>У Магазин</button>
        </div>
      </div>
    );
  }

  const wish = wishFor(plant.growth_stage);
  const missing = (care[wish.need] ?? 0) <= 0;

  return (
    <div style={{ position: "relative", minHeight: "100%", background: "linear-gradient(180deg, var(--sky1), var(--sky2))" }}>
      <div style={{ padding: "8px 12px 0", textAlign: "center" }}>
        <button style={{ fontSize: 17, fontWeight: 800 }} onClick={() => ctx.push("plantName", { plant })}>
          {plant.name || "Без імені"}
        </button>
        <div className="muted" style={{ fontSize: 13 }}>
          стадія {plant.growth_stage} з 10 · {plant.mood === "healthy" ? "усе добре" : plant.mood === "sad" ? "хоче пити" : "зовсім засумував"}
        </div>
      </div>

      {missing && (
        <button
          onClick={() => ctx.openTab("shop")}
          style={{ position: "relative", display: "block", margin: "6px auto 0", width: 210 }}
          title={`Кавенятку потрібен ${wish.label}`}
        >
          <img src="/assets/ui/cloud.png" alt="" style={{ width: "100%" }} />
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
            <img src={wish.icon} alt="" style={{ width: 22 }} />
            хочу {wish.label}
          </span>
        </button>
      )}

      <PlantView plant={plant} size={250} />

      <div style={{ position: "relative", margin: "0 12px 12px" }}>
        <img src="/assets/ui/shelf.png" alt="Поличка з препаратами" style={{ width: "100%" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-around", paddingBottom: "12%" }}>
          {SHELF.map((s) => {
            const n = care[s.key] ?? 0;
            return (
              <button key={s.key} title={s.title} onClick={() => ctx.openTab("shop")}
                      style={{ position: "relative", width: "20%" }}>
                <img src={n > 0 ? s.full : s.empty} alt={s.title} style={{ width: "100%" }} />
                <span style={{ position: "absolute", right: -4, bottom: -4, minWidth: 30, padding: "2px 6px", borderRadius: 999, background: "var(--panel)", border: "1px solid var(--line)", fontSize: 11, fontWeight: 700 }}>
                  {n} {s.unit}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="stage-pad" style={{ paddingTop: 0 }}>
        <div className="grid2">
          <button className="btn" onClick={() => ctx.push("wardrobe", { plant })}>Гардероб</button>
          <button className="btn" onClick={() => ctx.push("chat", { plant })}>Поговорити</button>
        </div>
      </div>
    </div>
  );
}
