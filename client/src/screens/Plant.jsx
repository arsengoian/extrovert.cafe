// Головний екран: небо, кавенятко, хмаринка з бажанням і поличка з
// препаратами (design: «{{ g.label }}», вкладка plant).
//
// Чого кущ хоче — каже сервер (plant.growth): таблиця переходів живе в
// economy.json, і другої її копії тут бути не має.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";

const SHELF = [
  { kind: "water", key: "water_liters", title: "Лійка", unit: "л", full: "/assets/ui/bucket.png", empty: "/assets/ui/bucket_empty.png" },
  { kind: "fertilizer", key: "fertilizer_kg", title: "Добриво", unit: "кг", full: "/assets/ui/mineral.png", empty: "/assets/ui/mineral_empty.png" },
  { kind: "insecticide", key: "insecticide_bottles", title: "Інсектицид", unit: "шт", full: "/assets/ui/insecticide.png", empty: "/assets/ui/insecticide_empty.png" },
  { kind: "compost", key: "compost_kg", title: "Компост", unit: "кг", full: "/assets/ui/compost.png", empty: "/assets/ui/compost_empty.png" },
];

const CARE = {
  water: { label: "води", icon: "/assets/ui/want_water.png", key: "water_liters" },
  compost: { label: "компост", icon: "/assets/ui/want_compost.png", key: "compost_kg" },
  fertilizer: { label: "добриво", icon: "/assets/ui/mineral.png", key: "fertilizer_kg" },
  insecticide: { label: "оприскування", icon: "/assets/ui/want_insecticide.png", key: "insecticide_bottles" },
};

const PLANTING_TITLE = { leaves: "Посадка листя", branches: "Посадка гілок", buds: "Посадка бутонів" };

// Репліка в хмаринці — за стадією, як у дизайні: кавенятко пояснює, навіщо
// йому саме цей препарат, а не просто називає його.
const WISH_LINE = [
  "Мене щойно посадили. Полий мене, будь ласка",
  "Дай компост – і піде листя",
  "Ще компосту – і вижену гілки",
  "Добриво – і будуть перші бутони",
  "Перший бутон є. Ще добрива – буде три",
  "Три бутони. Цього разу випало добриво – буде п’ять",
  "П’ять бутонів, і хтось гризе листя. Оприскай",
  "Сім бутонів. Оприскай – і я зацвіту",
  "Я цвіту. Оприскай, щоб квіти стали бобами",
  "Боби зелені. Ще оприскування – і достигнуть",
  "Боби достигли. Тепер одягни мене!",
];
const SAD_LINE = "Три дні без поливу. Полий мене, будь ласка";
const WITHERED_LINE = "Мене не поливали тиждень. Води, будь ласка";
// Текст лежить на світлій хмаринці, тому колір фіксований, а не з теми.
const CLOUD_INK = "#3A2412";

export function Plant({ ctx }) {
  const [plant, setPlant] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const care = ctx.me?.care ?? {};

  const reload = () => api.get("/me/plants").then((r) => setPlant(r.plants[0] ?? null));
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);

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

  const growth = plant.growth ?? {};
  const wish = CARE[growth.need] ?? null;
  const line = plant.mood === "withered" ? WITHERED_LINE
    : plant.mood === "sad" ? SAD_LINE
    : WISH_LINE[plant.growth_stage] ?? "Хочу уваги";
  const missing = wish ? (care[wish.key] ?? 0) <= 0 : false;

  const openPlanting = () => {
    // Добовий гейт видно ще до відкриття екрана: інакше гравець розставить
    // двадцять листків і лише на «Посадити» дізнається, що зарано.
    if (growth.ready_at) { setNote("Одна стадія на добу — приходь завтра"); return; }
    ctx.push("planting", { plantId: plant.id, title: PLANTING_TITLE[growth.planting] ?? "Посадка" });
  };

  // Один тап по банці = одне застосування. Сервер вирішує, чи це рухає
  // стадію, чи кущ просто попив, чи час відкривати екран посадки.
  const apply = async (kind) => {
    if ((care[CARE[kind]?.key] ?? 0) <= 0) { ctx.openTab("shop"); return; }
    if (growth.planting && kind === growth.need) { openPlanting(); return; }
    setNote(null);
    try {
      const r = await api.post(`/me/plants/${plant.id}/care`, { kind });
      await ctx.refreshMe();
      await reload();
      if (r.grown) setNote(`Кавенятко підросло: стадія ${r.stage}`);
      else if (r.progress) setNote(`Полито ${r.progress} з ${r.applications}`);
    } catch (e) {
      const code = e.body?.error;
      if (code === "needs_planting") openPlanting();
      else if (code === "wrong_care") setNote(`Зараз кавенятко хоче ${CARE[e.body.need]?.label ?? e.body.need}`);
      else if (code === "too_soon") setNote("Одна стадія на добу — приходь завтра");
      else if (code === "no_supply") ctx.openTab("shop");
      else if (code === "fully_grown") setNote("Кавенятко вже доросле");
      else setNote(e.message);
    }
  };

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

      {plant.draft && (
        <button className="panel row" onClick={openPlanting}
                style={{ margin: "8px 12px 0", gap: 10, borderColor: "var(--accent)" }}>
          <img src="/assets/ui/compost.png" alt="" style={{ width: 20 }} />
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Незавершена посадка</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {plant.draft.count ? `${plant.draft.count} елементів у чернетці` : "чернетка збережена"}, препарат ще не списано
            </div>
          </div>
          <span className="muted">›</span>
        </button>
      )}

      {wish && (
        <button
          onClick={() => (missing ? ctx.openTab("shop") : apply(growth.need))}
          style={{ position: "relative", display: "block", margin: "6px auto 0", width: 230 }}
          title={`Кавенятку потрібен ${wish.label}`}
        >
          <img src="/assets/ui/cloud.png" alt="" style={{ width: "100%" }} />
          <span style={{ position: "absolute", inset: "12% 14% 26%", display: "flex", alignItems: "center", gap: 8,
                        color: CLOUD_INK, fontSize: 12, fontWeight: 700, lineHeight: 1.25, textAlign: "left" }}>
            <img src={wish.icon} alt="" style={{ width: 24, flex: "none" }} />
            <span>{line}</span>
          </span>
        </button>
      )}

      <PlantView plant={plant} width={250} />

      {note && <div className="panel muted" style={{ margin: "0 12px 10px", fontSize: 12.5, textAlign: "center" }}>{note}</div>}

      <div style={{ position: "relative", margin: "0 12px 12px" }}>
        <img src="/assets/ui/shelf.png" alt="Поличка з препаратами" style={{ width: "100%" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-around", paddingBottom: "12%" }}>
          {SHELF.map((s) => {
            const n = care[s.key] ?? 0;
            const wanted = growth.need === s.kind;
            return (
              <button key={s.key} title={s.title} onClick={() => apply(s.kind)}
                      style={{ position: "relative", width: "20%", filter: wanted ? "drop-shadow(0 0 10px rgba(254,129,11,.8))" : "none" }}>
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
