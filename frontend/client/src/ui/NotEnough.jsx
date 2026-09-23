// «Попап · не вистачає монет» і його близнюк для зерен: скільки бракує й
// чим закрити нестачу —
// набір монет, кава на точці, опитування, обмін зерен, продаж на P2P.
// Недоступний спосіб не ховаємо, а приглушуємо з поясненням: гравець
// бачить, що такий шлях існує.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmSheet } from "./Popup.jsx";
import { plural } from "./plural.js";

// Слоти повного комплекту — ті самі, що в гардеробі (economy.set.slots).
const SET_SLOTS = ["head", "body", "pants", "feet", "acc_1"];

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

// Монета в тексті — це знак, а не блок: inline + зсув по базовій лінії, як
// у гардеробі. Раніше рядки з іконками були флексами, і текст розсипався на
// шматки з розривами до і після монети (скарга власника 23.09.2026).
const coin = (w, h) => ({ width: w, height: h, display: "inline", verticalAlign: -3 });
const Gold = ({ w = 14, h = 15 }) => <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={coin(w, h)} />;
const Bean = ({ w = 14, h = 16 }) => <img src="/assets/ui/bean.png" alt="зерна" style={coin(w, h)} />;
const Silver = ({ w = 14, h = 15 }) => <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={coin(w, h)} />;
const Coins2 = () => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 16, height: 17 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 16, height: 17, marginLeft: -7 }} />
  </span>
);

function Way({ icon, title, sub, pill, primary, off, accent, onClick }) {
  return (
    <div className="earn-row" data-off={off || undefined} data-accent={accent || undefined}>
      {icon}
      <div className="earn-main">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      {pill && (
        <button className={`pill${primary && !off ? " pill-primary" : ""}${off ? " pill-off" : ""}`} disabled={off} onClick={onClick}>
          {pill}
        </button>
      )}
    </div>
  );
}

// what — що купують («Скринька»), price — ціна, have — скільки монет є.
export function NotEnoughCoins({ what, price, have, ctx, onClose }) {
  const [ways, setWays] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get("/shop/coin-packs").catch(() => ({ packs: [] })),
      api.get("/catalog/drinks").catch(() => ({ drinks: [] })),
      api.get("/quiz/drink").catch(() => ({ credits: 0, reward: 40 })),
      api.get("/shop").catch(() => ({ beans: [] })),
      api.get("/me/items").catch(() => ({ items: [] })),
    ]).then(([packs, drinks, quiz, shop, items]) => {
      const cheapest = [...(packs.packs ?? [])].sort((a, b) => a.price_uah - b.price_uah)[0] ?? null;
      const coins = (drinks.drinks ?? []).map((d) => d.coins).filter((c) => c > 0);
      setWays({
        pack: cheapest,
        drinkCoins: coins.length ? [Math.min(...coins), Math.max(...coins)] : null,
        quiz,
        exchange: (shop.beans ?? []).find((i) => i.code === "beans_to_coins") ?? null,
        free: (items.items ?? []).reduce((n, it) => n + (it.free ?? 0), 0),
      });
    });
  }, []);

  const go = (fn) => () => { onClose(); fn(); };
  const beans = ctx.me?.balances?.beans ?? 0;
  const rate = ways?.exchange?.gives_coins ?? 15;

  return (
    <ConfirmSheet onCancel={onClose} closable gap={12}>
      <div className="short-title">Бракує {fmt(price - have)} <Gold w={20} h={21} /></div>
      <div className="short-note">{what} коштує {fmt(price)} <Coins2 />, у тебе {fmt(have)}.</div>

      {ways && (
        <div className="earn-list">
          {/* Кава на точці — перша: це основний спосіб, а не крайній
              (рішення власника 23.09.2026). */}
          {ways.drinkCoins && (
            <Way icon={<img src="/assets/drinks/latte.png" alt="" style={{ width: 30, height: 30 }} />}
                 title="Купити каву на точці"
                 sub={<>від {ways.drinkCoins[0]} до {ways.drinkCoins[1]} <Gold /> за напій</>} />
          )}
          {ways.pack && (
            <Way accent primary icon={<img src="/assets/ui/coin_gold.png" alt="" style={{ width: 30, height: 31 }} />}
                 title="Купити набір монет"
                 sub={<>{fmt(ways.pack.coins)} <Gold /> за {fmt(ways.pack.price_uah)} ₴ · одразу</>}
                 pill="Купити" onClick={go(() => ctx.push("coinPacks"))} />
          )}
          <Way primary off={!ways.quiz.credits} icon={<Silver w={28} h={29} />}
               title="Опитування про напій"
               sub={ways.quiz.credits ? <>+{ways.quiz.reward} <Silver />, доступне зараз</> : "поки недоступне"}
               pill="Пройти" onClick={go(() => ctx.openTab("history"))} />
          <Way off={!beans} icon={<img src="/assets/ui/beans_to_coins.png" alt="" style={{ width: 26, height: 28 }} />}
               title={<>Обміняти <Bean w={15} h={17} /></>}
               sub={beans ? <>{beans} <Bean /> → {fmt(beans * rate)} <Gold /></> : "зерен поки немає"}
               pill="Обмін" onClick={go(() => ctx.push("shopProduct", { item: ways.exchange }))} />
          <Way off={!ways.free} icon={<img src="/assets/ui/cowboy_body.png" alt="" style={{ width: 27, height: 28 }} />}
               title="Продати одяг на ринку"
               sub={ways.free ? `вільних предметів: ${ways.free}` : "вільних предметів немає"}
               pill="Склад" onClick={go(() => ctx.openTab("stock"))} />
        </div>
      )}

      <div className="short-foot"><Gold /> в <Bean /> не обмінюються.</div>
    </ConfirmSheet>
  );
}

// Те саме для зерен. Способів тут менше, бо зерна не продаються за гривні
// й не обмінюються з монет: єдине джерело — подарований кавенятку повний
// комплект одягу (economy §3.4), а одяг до нього беруть зі скриньок, ринку
// й крамниці.
export function NotEnoughBeans({ what, price, have, ctx, onClose }) {
  const [ways, setWays] = useState(null);

  // Обидва способи мають бути видні навіть коли зараз недоступні —
  // приглушені, як у попапі монет (прохання власника 23.09.2026). Тому
  // питаємо, чи є кавенятко й чи є з чого зібрати повний комплект: у
  // комплекті пʼять слотів, і потрібна вільна річ у кожному.
  useEffect(() => {
    Promise.all([
      api.get("/me/plants").catch(() => ({ plants: [] })),
      api.get("/me/items").catch(() => ({ items: [] })),
    ]).then(([mine, stock]) => {
      const plants = mine.plants ?? [];
      const slots = new Set((stock.items ?? []).filter((i) => i.free > 0).map((i) => i.slot));
      setWays({
        plant: plants[0] ?? null,
        stage: plants[0]?.growth_stage ?? 0,
        canDress: SET_SLOTS.every((slot) => slots.has(slot)),
        missing: SET_SLOTS.filter((slot) => !slots.has(slot)).length,
      });
    });
  }, []);

  const go = (fn) => () => { onClose(); fn(); };
  return (
    <ConfirmSheet onCancel={onClose} closable gap={12}>
      <div className="short-title">Бракує {fmt(price - have)} <Bean w={19} h={21} /></div>
      <div className="short-note">{what} коштує {fmt(price)} <Bean />, у тебе {fmt(have)}.</div>

      {ways && (
        <div className="earn-list">
          <Way accent primary off={!ways.plant}
               icon={<img src="/assets/ui/bean.png" alt="" style={{ width: 26, height: 29 }} />}
               title="Виростити кавенятко"
               sub={ways.plant ? `стадія ${ways.stage} – зерна дає доросле кавенятко` : "кавенятка ще немає"}
               pill="Кавенятко" onClick={go(() => ctx.openTab("plant"))} />
          <Way off={!ways.canDress}
               icon={<img src="/assets/ui/cowboy_body.png" alt="" style={{ width: 27, height: 28 }} />}
               title="Подарувати комплект кавенятку"
               sub={ways.canDress
                 ? "повний комплект одягу дає зерна – тим більше, чим вища рідкість"
                 : `бракує речей на ${ways.missing} ${plural(ways.missing, "слот", "слоти", "слотів")}`}
               pill="Гардероб"
               onClick={ways.plant ? go(() => ctx.push("wardrobe", { plant: ways.plant })) : undefined} />
        </div>
      )}

      <div className="short-foot"><Gold /> в <Bean /> не обмінюються.</div>
    </ConfirmSheet>
  );
}
