// «Нове кавенятко» — кадр «Придбання кавенятка»: два саджанці від кафе (за
// монети й за зерна) і лоти інших гравців. Свій саджанець завжди
// починається з нуля, чуже кавенятко приходить із уже вирощеним виглядом —
// тому вони стоять поруч.
//
// Маркет показує не весь список, а вибірку, де дешевші лоти трапляються
// частіше (services.md §4), тож перший лот — головна пропозиція.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { LoadFailed } from "../ui/Net.jsx";
import { NotEnoughBeans, NotEnoughCoins } from "../ui/NotEnough.jsx";
import { PlantView } from "../plant/PlantView.jsx";
import { plural } from "../ui/plural.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { BuyConfirm } from "../ui/BuyConfirm.jsx";
import { rememberPlant } from "../plant/selected.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

const Coins2 = () => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.webp" alt="срібні монети" style={{ width: 18, height: 19 }} />
    <img src="/assets/ui/coin_gold.webp" alt="золоті монети" style={{ width: 18, height: 19, marginLeft: -6 }} />
  </span>
);

// «Стадія 10 · 2 повні комплекти», «Стадія 7 · без одягу», «Стадія 2 · початок».
const lotFacts = (p) => {
  const tail = p.full_sets ? `${p.full_sets} ${plural(p.full_sets, "повний комплект", "повні комплекти", "повних комплектів")}`
    : p.growth_stage < 3 ? "початок" : "без одягу";
  return `Стадія ${p.growth_stage}, ${tail}`;
};

export function PlantMarket({ ctx }) {
  const [offers, setOffers] = useState(null);
  const [failed, setFailed] = useState(false);
  const [shop, setShop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Що підтверджуємо: тап по саджанцю чи «Купити» біля лота більше не
  // купує одразу, а відкриває попап із ціною й балансом після покупки
  // (власник, 01.10.2026: покупка одним тапом списувала монети без питання).
  const [picked, setPicked] = useState(null);

  const load = () => Promise.all([
    api.get("/market/plants?limit=10").then((r) => { setFailed(false); setOffers(r.offers); }).catch(() => setFailed(true)),
    api.get("/shop").then(setShop).catch(() => setShop(null)),
  ]);
  useEffect(() => { load(); }, []);

  const saplings = shop ? [...shop.coins, ...shop.beans].filter((i) => i.kind === "sapling") : [];

  // Купили — одразу на вкладку кавенятка: там нове кавенятко й попросить ім'я.
  // Нестача — не текст під кнопкою, а попап зі способами дібрати
  // (кадр «Не вистачає монет»): він однаково потрібен і для монет, і для
  // зерен, різниця лише в тому, звідки їх беруть.
  const short = (currency, what, price) => {
    const b = ctx.me?.balances ?? {};
    const have = currency === "beans" ? b.beans ?? 0 : (b.silver ?? 0) + (b.yellow ?? 0);
    const Popup = currency === "beans" ? NotEnoughBeans : NotEnoughCoins;
    ctx.notify(<Popup what={what} price={price} have={have} ctx={ctx} onClose={() => ctx.notify(null)} />);
  };

  // Куплено — попап успіху над вкладкою кавенятка, і нове кавенятко на
  // головному екрані обране (і з ринку теж). Ім'я саджанцю попросить уже
  // головний екран.
  const buy = async (request, lack) => {
    setBusy(true);
    setError(null);
    try {
      const r = await request();
      if (r?.plant_id) rememberPlant(r.plant_id);
      await ctx.refreshMe();
      setPicked(null);
      ctx.openTab("plant");
      const close = () => ctx.notify(null);
      ctx.notify(
        <ResultPopup art={<img src="/assets/ui/sprout.webp" alt="" style={{ width: 40, height: 62, objectFit: "contain" }} />}
                     title={lack.what === "Саджанець" ? "Саджанець твій!" : "Кавенятко твоє!"} onClose={close}>
          <div className="result-note">
            {lack.what === "Саджанець"
              ? "Він уже на головному екрані – дай йому ім'я, і можна поливати."
              : "Воно вже на головному екрані разом з усім подарованим йому одягом."}
          </div>
        </ResultPopup>
      );
    } catch (e) {
      setPicked(null);
      const code = e.body?.error;
      if (code === "not_enough") short(lack.currency, lack.what, lack.price);
      else setError(code === "already_gone" ? "Цей лот уже купили" : e.message);
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
                  onClick={() => setPicked({ what: "Саджанець", name: "Саджанець", currency: item.currency, price: item.price,
                                             request: () => api.post("/shop/buy", { code: item.code }) })}>
            <img src="/assets/ui/sprout.webp" alt="" />
            <b>Саджанець</b>
            <span>
              {item.currency === "beans" ? <img src="/assets/ui/bean.webp" alt="зерна" style={{ width: 17, height: 19 }} /> : <Coins2 />}
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
      {offers === null && (failed ? <LoadFailed onRetry={() => { setFailed(false); load(); }} /> : <div className="skeleton" />)}
      {offers?.length === 0 && (
        <div className="sell-note">Зараз ніхто не продає кавенят. Заглянь пізніше – лоти зʼявляються й зникають.</div>
      )}
      <div className="pm-lots">
        {offers?.map((lot, i) => (
          <div key={lot.id} className="pm-lot">
            <div className="pm-thumb">
              <PlantView plant={{ growth_stage: lot.plant?.growth_stage ?? 0, appearance: lot.plant?.appearance, face_set_id: lot.plant?.face_set_id, mood: "healthy" }}
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
                  ? <img src="/assets/ui/bean.webp" alt="зерна" style={{ width: 16, height: 18 }} />
                  : <img src="/assets/ui/coin_gold.webp" alt="золоті монети" style={{ width: 17, height: 18 }} />}
                {fmt(lot.price)}
              </span>
              <button className={`pill${i === 0 ? " pill-primary" : ""}`} disabled={busy}
                      onClick={() => setPicked({ what: "Кавенятко", name: lot.plant?.name || "Без імені", seller: lot.seller, lot,
                                                 currency: lot.currency, price: lot.price,
                                                 request: () => api.post(`/market/listings/${lot.id}/buy`) })}>
                Купити
              </button>
            </div>
          </div>
        ))}
      </div>

      {picked && <PlantBuyConfirm picked={picked} me={ctx.me} busy={busy} onCancel={() => setPicked(null)}
                             onBuy={() => buy(picked.request, picked)} />}
    </div>
  );
}

// Підтвердження — спільне для всіх покупок (ui/BuyConfirm.jsx).
function PlantBuyConfirm({ picked, me, busy, onCancel, onBuy }) {
  // Саджанець за монети платиться й срібними, лот на ринку — лише жовтими.
  const currency = picked.currency === "beans" ? "beans" : picked.lot ? "yellow" : "coins";
  const art = picked.lot
    ? <span style={{ width: 120, height: 138, flex: "none" }}>
        <PlantView plant={{ growth_stage: picked.lot.plant?.growth_stage ?? 0, appearance: picked.lot.plant?.appearance, face_set_id: picked.lot.plant?.face_set_id, mood: "healthy" }}
                   worn={picked.lot.plant?.worn} width={120} height={138} platform={false} pad={4} />
      </span>
    : <img src="/assets/ui/sprout.webp" alt="" style={{ width: 78, height: 120, objectFit: "contain" }} />;
  return (
    <BuyConfirm art={art} title={picked.name}
                price={picked.price} currency={currency} balances={me?.balances} busy={busy} onCancel={onCancel} onBuy={onBuy} />
  );
}
