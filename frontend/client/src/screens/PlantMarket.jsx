// «Нове кавенятко»: два саджанці від кафе (за монети й за зерна) і лоти
// інших гравців. Свій саджанець завжди починається з нуля, чуже кавенятко
// приходить із уже вирощеним виглядом — тому вони стоять поруч.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { coins as coinsWord } from "../ui/plural.js";

export function PlantMarket({ ctx }) {
  const [offers, setOffers] = useState(null);
  const [shop, setShop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const load = () => Promise.all([
    api.get("/market/plants?limit=10").then((r) => setOffers(r.offers)).catch(() => setOffers([])),
    api.get("/shop").then(setShop).catch(() => setShop(null)),
  ]);
  useEffect(() => { load(); }, []);

  const saplings = (shop
    ? [...shop.coins, ...shop.beans].filter((i) => i.kind === "sapling")
    : []);

  const buySapling = async (item) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/shop/buy", { code: item.code });
      await ctx.refreshMe();
      setNote("Саджанець твій – знайди його на головному екрані.");
    } catch (e) {
      setError(e.body?.error === "not_enough" ? "Не вистачає" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const buyLot = async (lot) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/market/listings/${lot.id}/buy`);
      await ctx.refreshMe();
      setNote(`Кавенятко «${lot.plant?.name ?? "без імені"}» тепер твоє.`);
      await load();
    } catch (e) {
      const code = e.body?.error;
      setError(code === "already_gone" ? "Лот уже купили" : code === "not_enough" ? "Не вистачає" : code ?? e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad">
      <div className="grid2">
        {saplings.map((item) => (
          <button key={item.code} className="panel" style={{ textAlign: "center" }} disabled={busy}
                  onClick={() => buySapling(item)}>
            <img src={`/${item.icon}`} alt="" style={{ width: 56, height: 56, objectFit: "contain", margin: "0 auto" }} />
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Саджанець</div>
            <div className="price" style={{ justifyContent: "center", marginTop: 4 }}>
              {item.price}
              <img src={item.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
            </div>
          </button>
        ))}
      </div>

      <div className="row-between" style={{ margin: "18px 4px 8px" }}>
        <span className="sectionTitle" style={{ margin: 0 }}>P2P маркет</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {offers === null ? "…" : `${offers.length} пропозицій`}
        </span>
      </div>

      {offers === null && <div className="skeleton" />}
      {offers?.length === 0 && (
        <div className="panel muted" style={{ fontSize: 13 }}>
          Зараз ніхто не продає кавенят. Загляни пізніше – лоти зʼявляються й зникають.
        </div>
      )}
      {offers?.map((lot) => (
        <div key={lot.id} className="panel row" style={{ gap: 12, padding: 12 }}>
          <div style={{ width: 72, flex: "none" }}>
            <PlantView plant={{ growth_stage: lot.plant?.growth_stage ?? 0, appearance: lot.plant?.appearance }}
                       width={72} pad={4} platform={false} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{lot.plant?.name || "Без імені"}</div>
            <div className="muted" style={{ fontSize: 12 }}>продає {lot.seller}</div>
            <div className="muted" style={{ fontSize: 12 }}>Стадія {lot.plant?.growth_stage}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="price" style={{ fontSize: 13 }}>
              {lot.price}
              <img src={lot.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
            </div>
            <button className="btn" style={{ width: "auto", height: 30, padding: "0 12px", fontSize: 12, marginTop: 4 }}
                    disabled={busy} onClick={() => buyLot(lot)}>Купити</button>
          </div>
        </div>
      ))}

      {note && <div className="panel" style={{ borderColor: "var(--accent)", fontWeight: 700 }}>{note}</div>}
      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}
      <p className="muted" style={{ fontSize: 12 }}>
        Саджанець за {coinsWord(saplings.find((s) => s.currency === "yellow")?.price ?? 1000)} росте з нуля,
        чуже кавенятко приходить із готовим виглядом і одягом.
      </p>
    </div>
  );
}
