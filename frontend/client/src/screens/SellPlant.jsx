// «Продати кавенятко»: лот із живої рослини — з її виглядом, стадією й
// подарованим одягом.
//
// Комісія на кавенят менша, ніж на одяг (2 % проти 10 %): це рідкісна
// угода на великі суми, і десятина з неї виглядала б як штраф за продаж.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { coins as coinsWord } from "../ui/plural.js";

const MIN = { yellow: 10, beans: 2 };

export function SellPlant({ plant, ctx }) {
  const [currency, setCurrency] = useState("yellow");
  const [price, setPrice] = useState("500");
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [listed, setListed] = useState(false);

  useEffect(() => {
    api.get(`/me/plants/${plant.id}/wardrobe`).then(setSummary).catch(() => setSummary(null));
  }, [plant.id]);

  const value = Math.trunc(Number(price) || 0);
  const commission = Math.round((value * 2) / 100);
  const appearance = plant.appearance ?? {};
  const skins = new Set((appearance.leaves_bg ?? []).map((l) => l.skin)).size;

  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/market/listings", { kind: "plant", plant_id: plant.id, price: value, currency });
      setListed(true);
    } catch (e) {
      const code = e.body?.error;
      setError(code === "last_plant" ? "Це твоє єдине кавенятко – спершу заведи ще одне"
        : code === "already_listed" ? "Кавенятко вже на маркеті"
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  if (listed) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <PlantView plant={plant} width={180} />
          <div className="h2">Лот на маркеті</div>
          <p className="muted">
            Поки кавенятко продається, воно заморожене: ні догляду, ні посадки, ні чату.
            Зняти лот можна на екрані «На продажу».
          </p>
          <button className="btn btn-primary" onClick={ctx.pop}>Готово</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage-pad">
      <div className="panel row" style={{ gap: 12 }}>
        <div style={{ width: 92, flex: "none" }}>
          <PlantView plant={plant} width={92} pad={4} platform={false} />
        </div>
        <div>
          <div style={{ fontWeight: 800 }}>{plant.name || "Без імені"}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Стадія {plant.growth_stage}
            {summary?.set?.gifted ? " · подарований комплект" : ""}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {skins ? `${skins} скіни листя · ` : ""}{(appearance.branches ?? []).length} гілки
          </div>
        </div>
      </div>

      <div className="sectionTitle">Ціна</div>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        {["yellow", "beans"].map((c) => (
          <button key={c} className="btn" style={{ flex: 1, height: 42, ...(currency === c
            ? { background: "var(--grad)", color: "var(--accent-ink)", border: 0 } : {}) }}
                  onClick={() => setCurrency(c)}>
            <img src={c === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt=""
                 style={{ width: 18 }} />
            {c === "beans" ? "зерна" : "монети"}
          </button>
        ))}
      </div>
      <div className="panel row" style={{ gap: 10 }}>
        <input className="price-input" inputMode="numeric" value={price}
               onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <img src={currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" style={{ width: 22 }} />
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
        Комісія 2 % – {commission}. Мінімальна ціна – {MIN[currency]}{currency === "beans" ? " зерна" : " монет"}.
      </p>

      <div className="panel">
        <div className="h2">Як працює продаж</div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          Кавенятко піде до покупця в тому одязі, який ти йому подарував. Те, що просто примірялось,
          повернеться на склад.
        </p>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 0 }}>
          Поки кавенятко на маркеті, доглядати за ним неможливо – але й сумувати воно не буде.
          Дешевші лоти маркет пропонує покупцям частіше.
        </p>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" disabled={busy || value < MIN[currency]} onClick={list}>
        {busy ? "Виставляємо…" : `Виставити за ${currency === "beans" ? `${value} зерен` : coinsWord(value)}`}
      </button>
    </div>
  );
}
