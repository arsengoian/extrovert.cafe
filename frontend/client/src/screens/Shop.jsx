// Магазин — за макетом «Gamification Screens», кадри «Магазин · за монети»
// й «Магазин · за кавові боби». Перемикач валюти, розділи, плитки й
// однорядкові списки: структура з макета, вміст — із /shop.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";

// Дві монети внахлест: у макеті так показано «за будь-які монети».
// Розмір і нахлест у кожному місці свої: перемикач 16/7, скринька 18/6,
// рядки догляду 17/6.
const Coins2 = ({ size = 16, overlap = 7 }) => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: size, height: size + 1 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: size, height: size + 1, marginLeft: -overlap }} />
  </span>
);

const Bean = ({ size = 18 }) => (
  <img src="/assets/ui/bean.png" alt="боби" style={{ width: size, height: size + 2 }} />
);

// Розміри картинок — з макета: у кожної свої пропорції, і «вписати в
// квадрат» дає не ті пікселі.
const ART = {
  water: [30, 33], compost: [24, 35], fertilizer: [19, 36], insecticide: [22, 36],
  sapling: [22, 34], sapling_beans: [22, 34], pos_discount: [26, 35], beans_to_coins: [32, 34],
  coffee_250g: [44, 58], merch_cup: [48, 58], custom_print: [56, 56],
};
const Art = ({ item }) => {
  const [width, height] = ART[item.code] ?? [];
  return <img src={`/${item.icon}`} alt="" style={width ? { width, height, maxHeight: "none" } : undefined} />;
};

const price = (item) => (item.price_range ? item.price_range.join("-") : item.price);

// Плитка товару: на відміну від вітрини одягу картинка не тягнеться на
// всю висоту — вміст притиснутий догори, як у макеті.
function Tile({ item, onOpen, accent }) {
  return (
    <button className={`card-item${accent ? " on" : ""}`} onClick={() => onOpen(item)}>
      <Art item={item} />
      <span className="name">{item.title}</span>
      <span className="cost"><Bean />{price(item)}</span>
    </button>
  );
}

// Рядок догляду: одна лінія «Вода · 5 л» і ціна в колонці 78 px.
function CareRow({ item, onOpen }) {
  return (
    <button className="list-row" onClick={() => onOpen(item)}>
      <span className="ico"><Art item={item} /></span>
      <span className="name">{item.unit ? `${item.title} · ${item.unit}` : item.title}</span>
      <span className="cost"><Coins2 size={17} overlap={6} />{item.price}</span>
    </button>
  );
}

// Рядок за боби: назва з поясненням під нею й ціна праворуч; обмін
// замість ціни показує курс і шеврон.
function BeanRow({ item, onOpen }) {
  const exchange = item.kind === "exchange";
  return (
    <button className="list-row two" onClick={() => onOpen(item)}>
      <span className="ico"><Art item={item} /></span>
      <span className="name">
        {item.title}
        {exchange ? (
          <small className="rate">1 <img src="/assets/ui/bean.png" alt="боб" /> → {item.gives_coins} <img src="/assets/ui/coin_gold.png" alt="золотих монет" /></small>
        ) : (
          <small>{item.subtitle}</small>
        )}
      </span>
      {exchange ? (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" style={{ flex: "none" }}>
          <path d="M9.5 6 15.5 12 9.5 18" />
        </svg>
      ) : (
        <span className="cost-r"><Bean />{item.price}</span>
      )}
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
    // комплект, і вітрина з трьох заглушок виглядала б як поламаний магазин.
    api.get("/catalog/items")
      .then((r) => {
        const items = r.items ?? [];
        const drawn = items.filter((i) => /^cowboy_(head|body|feet)$/.test(i.sprite_id ?? ""));
        const order = { head: 1, body: 0, feet: 2 };
        drawn.sort((a, b) => order[a.slot] - order[b.slot]);
        setClothes((drawn.length === 3 ? drawn : items).slice(0, 3));
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
                  <span className="art"><ItemIcon sprite={it.sprite_id} size={58} name={it.name} style={{ width: 58 }} /></span>
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
                  <div><Coins2 size={18} overlap={6} />{crate.price}</div>
                  {crate.price_uah ? <small>або {crate.price_uah} ₴</small> : null}
                </span>
              </button>
            </div>
          )}

          {care.length > 0 && (
            <div className="section">
              <div className="sectionTitle">Догляд</div>
              <div className="list-card">
                {care.map((it) => <CareRow key={it.code} item={it} onOpen={open} />)}
                {sapling && <CareRow item={sapling} onOpen={open} />}
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
                Принт малюється з твого кавенятка – з його одягом, скінами й плодами на момент замовлення
              </div>
            </div>
          )}

          {onPoint.length > 0 && (
            <div className="section">
              <div className="sectionTitle">На точці</div>
              <div className="list-card">
                {onPoint.map((it) => <BeanRow key={it.code} item={it} onOpen={open} />)}
              </div>
            </div>
          )}

          {inGame.length > 0 && (
            <div className="section">
              <div className="sectionTitle">У грі</div>
              <div className="list-card">
                {inGame.map((it) => <BeanRow key={it.code} item={it} onOpen={open} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
