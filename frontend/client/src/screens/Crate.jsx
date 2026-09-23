// Прев'ю скриньки — кадр «Прев'ю скриньки»: скринька в сяйві, опис, шанси
// по тірах і дві ціни. Шанси показуємо до покупки — це вимога економіки
// (розділ 0, етична рекомендація), а не прикраса.
//
// Купівля й відкриття — окремі кроки: куплена скринька (за монети чи через
// mono) лягає на Склад, у картку «Щасливі скриньки», і відкривається звідти:
// анімація «Відкриття скриньки», потім попап «Скриньку відкрито».
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";
import { Sparks, burst, calm, markCoinSource } from "../ui/fx.jsx";
import { PENDING_KEY } from "./CoinPacks.jsx";

const TIERS = [["common", "Common"], ["uncommon", "Uncommon"], ["rare", "Rare"], ["epic", "Epic"]];

export function CrateOpened({ result, nickname, onClose, onStock, onSell }) {
  const { item, coins, was_duplicate: dup } = result;
  // «Окуляри-авіатори» — у два рядки по дефісу, як у макеті.
  const [first, ...rest] = item.name.split("-");
  return (
    <ResultPopup
      decor={<img className="crate-glow" src="/assets/ui/crate_glow.png" alt="" />}
      title="Скриньку відкрито"
      offset={88}
      side={16}
      action="На склад"
      onAction={onStock}
      onClose={onClose}
    >
      {/* «Дроп предмета»: іконка вистрибує, іскорок тим більше, чим рідший тір */}
      <div className="loot">
        <div className="loot-tile">
          <span className={`tier-${item.tier} fx-pop`} style={{ position: "relative", animationDelay: "80ms" }}>
            <ItemIcon sprite={item.sprite_id} size={64} alt={item.name} style={{ width: 64 }} />
            <Sparks kind={item.tier} x="50%" y="50%" delay={330} />
          </span>
          <small>{rest.length ? <>{first}-<br />{rest.join("-")}</> : item.name}</small>
        </div>
        <div className="loot-tile">
          <span className="fx-pop" style={{ animationDelay: "200ms" }}><img ref={markCoinSource} src="/assets/ui/coin_gold.png" alt="золоті монети" /></span>
          <b>+{coins}</b>
        </div>
      </div>
      <div className="loot-note">
        {dup
          ? <>У тебе такий уже є – <button className="doc-link" onClick={onSell}>продати дубль на ринку</button></>
          : <>Речі зараховано до акаунту <b>{nickname}</b></>}
      </div>
    </ResultPopup>
  );
}

// «Відкриття скриньки» з дошки анімацій: корпус тремтить, кришка відлітає
// обертом, зсередини спалах світла й конфеті — і лише тоді попап. Запит іде
// паралельно з анімацією: попап чекає і того, і того.
const OPENING_MS = 1500;

export function CrateOpening({ request, onDone, onError }) {
  const art = useRef(null);
  const host = document.querySelector(".app") ?? document.body;

  useEffect(() => {
    let alive = true;
    const wait = new Promise((r) => setTimeout(r, calm() ? 0 : OPENING_MS));
    const t = setTimeout(() => {
      const box = art.current?.getBoundingClientRect();
      const hb = host.getBoundingClientRect();
      if (box) burst(host, box.left - hb.left + box.width / 2, box.top - hb.top + box.height * 0.4, "crate");
    }, 760);
    Promise.all([request(), wait])
      .then(([result]) => alive && onDone(result))
      .catch((e) => alive && onError(e));
    return () => { alive = false; clearTimeout(t); };
  }, []);

  return createPortal(
    <>
      <div className="sheet-backdrop" />
      <div className="crate-opening" ref={art}>
        <img className="crate-opening-glow" src="/assets/ui/crate_glow.png" alt="" />
        <div className="crate-opening-body">
          <img src="/assets/ui/crate.png" alt="щаслива скринька" />
          <div className="crate-opening-lid"><img src="/assets/ui/crate_lid.png" alt="" /></div>
        </div>
      </div>
    </>,
    host
  );
}

// Відкрити скриньку зі складу: анімація, потім попап над Складом.
export function openStockCrate(ctx, onOpened) {
  const close = () => ctx.notify(null);
  ctx.notify(
    <CrateOpening
      request={() => api.post("/me/crates/open")}
      onDone={async (result) => {
        onOpened?.(result.crates_left);
        const me = await ctx.refreshMe();
        ctx.notify(
          <CrateOpened result={result} nickname={me.nickname} onClose={close} onStock={close}
                       onSell={() => { close(); ctx.push("sellItem", { item: result.item }); }} />
        );
      }}
      onError={() => close()}
    />
  );
}

export function CratePreview({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const odds = item?.odds ?? {};
  const price = item?.price ?? 85;

  // Куплена скринька — на Складі: туди й ведемо, там вона чекає «Відкрити».
  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/shop/crate/buy");
      await ctx.refreshMe();
      ctx.openTab("stock");
    } catch (e) {
      if (e.body?.error === "not_enough_coins") {
        const have = e.body.have ?? (ctx.me?.balances?.silver ?? 0) + (ctx.me?.balances?.yellow ?? 0);
        ctx.notify(<NotEnoughCoins what="Скринька" price={price} have={have} ctx={ctx} onClose={() => ctx.notify(null)} />);
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // mono: рахунок, банк, повернення з ?pay=1 — той самий шлях, що в наборів
  // монет. Без ключа mono локально працює тестова оплата — одразу на склад.
  const buyMono = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/shop/crate/invoice");
      if (r.page_url) {
        localStorage.setItem(PENDING_KEY, r.invoice_id);
        window.location.href = r.page_url;
        return;
      }
      await ctx.refreshMe();
      ctx.openTab("stock");
    } catch (e) {
      setError(e.body?.error === "payments_not_connected" ? "Оплата карткою ще не підключена – скоро." : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quiz">
      <div className="crate-hero">
        <span className="crate-art big">
          <img src="/assets/ui/crate.png" alt="щаслива скринька" />
          <img src="/assets/ui/crate_lid.png" alt="" />
        </span>
      </div>

      <div className="preview-head">
        <h2>Щаслива скринька</h2>
        <p>Один тип скриньки на всіх. Шанси однакові незалежно від того, чим платиш.</p>
      </div>

      <div className="odds">
        {TIERS.map(([tier, label]) => (
          <div key={tier}>
            <span className={tier === "common" ? undefined : `tag-${tier}`}>{label}</span>
            <b>{Math.round((odds[tier] ?? 0) * 100)}%</b>
          </div>
        ))}
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="buy-row">
        <button className="cta" disabled={busy} onClick={buy}>
          <span className="coins2">
            <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 20, height: 21 }} />
            <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
          </span>
          {busy ? "…" : price}
        </button>
        <button className="cta ghost" disabled={busy} onClick={buyMono}>
          {item?.price_uah ?? 99} ₴ · mono
        </button>
      </div>
    </div>
  );
}
