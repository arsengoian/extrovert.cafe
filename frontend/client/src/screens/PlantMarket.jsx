// «Нове кавенятко» — кадр «Придбання кавенятка»: два саджанці від кафе (за
// монети й за зерна) і лоти інших гравців. Свій саджанець завжди
// починається з нуля, чуже кавенятко приходить із уже вирощеним виглядом —
// тому вони стоять поруч.
//
// Маркет показує не весь список, а вибірку, де дешевші лоти трапляються
// частіше (services.md §4), тож перший лот — головна пропозиція.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { plural } from "../ui/plural.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

const Coins2 = () => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 18, height: 19 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 18, height: 19, marginLeft: -6 }} />
  </span>
);

// «Стадія 10 · 2 повні комплекти», «Стадія 7 · без одягу», «Стадія 2 · початок».
const lotFacts = (p) => {
  const tail = p.full_sets ? `${p.full_sets} ${plural(p.full_sets, "повний комплект", "повні комплекти", "повних комплектів")}`
    : p.growth_stage < 3 ? "початок" : "без одягу";
  return `Стадія ${p.growth_stage} · ${tail}`;
};

export function PlantMarket({ ctx }) {
  const [offers, setOffers] = useState(null);
  const [shop, setShop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => Promise.all([
    api.get("/market/plants?limit=10").then((r) => setOffers(r.offers)).catch(() => setOffers([])),
    api.get("/shop").then(setShop).catch(() => setShop(null)),
  ]);
  useEffect(() => { load(); }, []);

  const saplings = shop ? [...shop.coins, ...shop.beans].filter((i) => i.kind === "sapling") : [];

  // Купили — одразу на вкладку кавенятка: там нове кавенятко й попросить ім'я.
  const buy = async (request, notEnough) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      await ctx.refreshMe();
      ctx.openTab("plant");
    } catch (e) {
      const code = e.body?.error;
      setError(code === "not_enough" ? notEnough : code === "already_gone" ? "Цей лот уже купили" : code ?? e.message);
      if (code === "already_gone") load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="pm-saplings">
        {saplings.map((item) => (
          <button key={item.code} className="pm-sapling" disabled={busy}
                  onClick={() => buy(() => api.post("/shop/buy", { code: item.code }), item.currency === "beans" ? "Не вистачає зерен" : "Не вистачає монет")}>
            <img src="/assets/ui/sprout.png" alt="" />
            <b>Саджанець</b>
            <span>
              {item.currency === "beans" ? <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 17, height: 19 }} /> : <Coins2 />}
              {fmt(item.price)}
            </span>
          </button>
        ))}
      </div>

      <div className="wr-section-head">
        <div className="sectionTitle">Ринок</div>
        <span>{offers === null ? "…" : `${offers.length} ${plural(offers.length, "пропозиція", "пропозиції", "пропозицій")}`}</span>
      </div>

      {error && <div className="sell-note" style={{ color: "var(--accent-text)" }}>{error}</div>}
      {offers === null && <div className="skeleton" />}
      {offers?.length === 0 && (
        <div className="sell-note">Зараз ніхто не продає кавенят. Заглянь пізніше – лоти зʼявляються й зникають.</div>
      )}
      <div className="pm-lots">
        {offers?.map((lot, i) => (
          <div key={lot.id} className="pm-lot">
            <div className="pm-thumb">
              <PlantView plant={{ growth_stage: lot.plant?.growth_stage ?? 0, appearance: lot.plant?.appearance, mood: "healthy" }}
                         worn={lot.plant?.worn} width={58} height={70} fit="stage" />
            </div>
            <div className="pm-info">
              <b>{lot.plant?.name || "Без імені"}</b>
              <small>продає {lot.seller}</small>
              <small>{lotFacts(lot.plant ?? { growth_stage: 0 })}</small>
            </div>
            <div className="pm-buy">
              <span>
                {lot.currency === "beans"
                  ? <img src="/assets/ui/bean.png" alt="зерна" style={{ width: 16, height: 18 }} />
                  : <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 17, height: 18 }} />}
                {fmt(lot.price)}
              </span>
              <button className={`pill${i === 0 ? " pill-primary" : ""}`} disabled={busy}
                      onClick={() => buy(() => api.post(`/market/listings/${lot.id}/buy`), lot.currency === "beans" ? "Не вистачає зерен" : "Не вистачає монет")}>
                Купити
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
