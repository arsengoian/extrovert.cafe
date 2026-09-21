// Магазин — за макетом «Gamification Screens», кадри «Магазин · за монети»
// й «Магазин · за кавові боби». Перемикач валюти, розділи, плитки й
// однорядкові списки: структура з макета, вміст — із /shop.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

// Дві монети внахлест: у макеті так показано «за будь-які монети».
const Coins2 = ({ size = 16 }) => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: size, height: size + 1 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: size, height: size + 1 }} />
  </span>
);

const Bean = ({ size = 18 }) => (
  <img src="/assets/ui/bean.png" alt="боби" style={{ width: size, height: size + 2 }} />
);

const Cost = ({ item }) => (
  <div className="cost">
    {item.currency === "beans" ? <Bean /> : <Coins2 size={18} />}
    {item.price ?? item.price_from}
  </div>
);

function Tile({ item, onOpen, accent }) {
  return (
    <button className={`card-item${accent ? " on" : ""}`} onClick={() => onOpen(item)}>
      <span className="art"><img src={`/${item.icon}`} alt="" /></span>
      <span className="name">{item.title}</span>
      <Cost item={item} />
    </button>
  );
}

function Row({ item, onOpen }) {
  return (
    <button className="list-row" onClick={() => onOpen(item)}>
      <span className="ico"><img src={`/${item.icon}`} alt="" /></span>
      <span className="name">{item.title}{item.subtitle ? <> · <span className="muted" style={{ fontWeight: 400 }}>{item.subtitle}</span></> : null}</span>
      <Cost item={item} />
    </button>
  );
}

export function Shop({ ctx }) {
  const [shop, setShop] = useState(null);
  const [clothes, setClothes] = useState([]);
  const [mode, setMode] = useState("coins");

  useEffect(() => {
    api.get("/shop").then(setShop).catch(() => setShop({ coins: [], beans: [] }));
    // Три речі для вітрини одягу: у макеті це прев'ю колекції, а не список.
    // Показуємо ті, у яких є намальований спрайт: поки це лише ковбойський
    // комплект (questions.md, «мапа предмет → спрайти»), і вітрина з трьох
    // заглушок виглядала б як поламаний магазин.
    api.get("/catalog/items")
      .then((r) => {
        const items = r.items ?? [];
        const drawn = items.filter((i) => /^cowboy/.test(i.sprite_id ?? ""));
        setClothes((drawn.length >= 3 ? drawn : items).slice(0, 3));
      })
      .catch(() => {});
  }, []);

  const open = (item) => {
    if (item.code === "clothing") return ctx.push("catalog");
    ctx.push(item.kind === "crate" ? "shopItem" : "shopProduct", { item });
  };

  const byCode = (list, code) => list?.find((i) => i.code === code);
  const coins = shop?.coins ?? [];
  const beans = shop?.beans ?? [];
  const crate = byCode(coins, "crate");
  const care = coins.filter((i) => i.kind === "care");
  const sapling = byCode(coins, "sapling");
  const delivery = beans.filter((i) => i.kind === "delivery");
  const onPoint = beans.filter((i) => i.kind === "discount");
  const inGame = beans.filter((i) => i.kind === "sapling" || i.kind === "exchange");
  const orders = ctx.me?.badges?.orders ?? 0;

  return (
    <div className="stage-pad">
      <div className="row">
        <div className="seg">
          <button data-on={mode === "coins"} onClick={() => setMode("coins")}>
            За <Coins2 />
          </button>
          <button data-on={mode === "beans"} onClick={() => setMode("beans")}>
            За <Bean size={15} />
          </button>
        </div>
        <button className="chip-btn" onClick={() => ctx.push("orders")}>
          Мої замовлення
          {orders > 0 && <i>{orders}</i>}
        </button>
      </div>

      {!shop && <div className="skeleton" />}

      {shop && mode === "coins" && (
        <>
          <div className="section">
            <div className="section-head">
              <div className="sectionTitle">Одяг</div>
              <button className="link-more" onClick={() => ctx.push("catalog")}>
                Весь одяг
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M9.5 6 15.5 12 9.5 18" />
                </svg>
              </button>
            </div>
            <div className="cards">
              {clothes.map((it) => (
                <button key={it.code} className="card-item" onClick={() => ctx.push("itemCard", { item: it })}>
                  <span className="art"><ItemIcon sprite={it.sprite_id} size={58} name={it.name} /></span>
                  <span className="name">{it.name}</span>
                  <span className="cost">
                    <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
                    {it.price_coins}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {crate && (
            <div className="section">
              <div className="sectionTitle">Перевір удачу</div>
              <button className="crate-row" onClick={() => open(crate)}>
                <span className="crate-art">
                  <img src="/assets/ui/crate.png" alt="щаслива скринька" />
                  <img src="/assets/ui/crate_lid.png" alt="" />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800 }}>{crate.title}</span>
                <span className="crate-price">
                  <div><Coins2 size={18} />{crate.price}</div>
                  {crate.price_uah ? <small>або {crate.price_uah} ₴</small> : null}
                </span>
              </button>
            </div>
          )}

          {care.length > 0 && (
            <div className="section">
              <div className="sectionTitle">Догляд</div>
              <div className="list-card">
                {care.map((it) => <Row key={it.code} item={it} onOpen={open} />)}
                {sapling && <Row item={sapling} onOpen={open} />}
              </div>
            </div>
          )}
        </>
      )}

      {shop && mode === "beans" && (
        <>
          {delivery.length > 0 && (
            <div className="section">
              <div className="sectionTitle">Реальні товари</div>
              <div className="cards">
                {delivery.map((it) => (
                  <Tile key={it.code} item={it} onOpen={open} accent={it.code === "custom_print"} />
                ))}
              </div>
              <div className="note-chip">
                <b>тільки твій</b>
                Принт малюється з твого кавенятка — з його одягом, скінами й плодами на момент замовлення
              </div>
            </div>
          )}

          {onPoint.length > 0 && (
            <div className="section">
              <div className="sectionTitle">На точці</div>
              <div className="list-card">
                {onPoint.map((it) => <Row key={it.code} item={it} onOpen={open} />)}
              </div>
            </div>
          )}

          {inGame.length > 0 && (
            <div className="section">
              <div className="sectionTitle">У грі</div>
              <div className="list-card">
                {inGame.map((it) => <Row key={it.code} item={it} onOpen={open} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
