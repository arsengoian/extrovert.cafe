// Прев'ю скриньки — кадр «Прев'ю скриньки»: скринька в сяйві, опис, шанси
// по тірах і дві ціни. Шанси показуємо до покупки — це вимога економіки
// (розділ 0, етична рекомендація), а не прикраса.
// Результат — попап «Скриньку відкрито» над Складом, куди й лягли речі.
import { useState } from "react";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";

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
      <div className="loot">
        <div className="loot-tile">
          <span className={`tier-${item.tier}`}>
            <ItemIcon sprite={item.sprite_id} size={64} alt={item.name} style={{ width: 64 }} />
          </span>
          <small>{rest.length ? <>{first}-<br />{rest.join("-")}</> : item.name}</small>
        </div>
        <div className="loot-tile">
          <span><img src="/assets/ui/coin_gold.png" alt="золоті монети" /></span>
          <b>+{coins}</b>
        </div>
      </div>
      <div className="loot-note">
        {dup
          ? <>У тебе такий уже є – <button className="doc-link" onClick={onSell}>продати дубль на P2P</button></>
          : <>Речі зараховано до акаунту <b>{nickname}</b></>}
      </div>
    </ResultPopup>
  );
}

export function CratePreview({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const odds = item?.odds ?? {};
  const price = item?.price ?? 85;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post("/shop/crate/open");
      const me = await ctx.refreshMe();
      const close = () => ctx.notify(null);
      ctx.openTab("stock");
      ctx.notify(
        <CrateOpened result={result} nickname={me.nickname} onClose={close} onStock={close}
                     onSell={() => { close(); ctx.push("sellItem", { item: result.item }); }} />
      );
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
        <button className="cta" disabled={busy} onClick={open}>
          <span className="coins2">
            <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 20, height: 21 }} />
            <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
          </span>
          {busy ? "…" : price}
        </button>
        {/* Скриньку за гривні mono pay ще не продає (є лише набори монет) —
            ціну показуємо, як у макеті, а на тап чесно кажемо. */}
        <button className="cta ghost" onClick={() => setError("Скринька за гривні зʼявиться разом з оплатою скриньок через mono pay")}>
          {item?.price_uah ?? 99} ₴ · mono
        </button>
      </div>
    </div>
  );
}
