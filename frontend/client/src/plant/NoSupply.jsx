// «Попап · не вистачає препарату»: кавенятко просить того, чого на поличці
// нема, — пачка з магазину одразу тут, і після купівлі препарат одразу йде
// в діло («Купити й посипати»).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { Coins2 } from "../ui/Coins.jsx";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";
import { useStageBottom } from "../ui/Popup.jsx";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

// Порожня банка з полички, підписи й дія — для кожного препарату свої.
const KIND = {
  water: { src: "bucket_empty", ratio: 229 / 226, of: "води", need: "потрібна вода", key: "water_liters", unit: "л", verb: "полити" },
  compost: { src: "compost_empty", ratio: 157 / 228, of: "компосту", need: "потрібен компост", key: "compost_kg", unit: "кг", verb: "посипати" },
  fertilizer: { src: "mineral_empty", ratio: 114 / 228, of: "добрива", need: "потрібне добриво", key: "fertilizer_kg", unit: "кг", verb: "посипати" },
  insecticide: { src: "insecticide_empty", ratio: 103 / 230, of: "інсектициду", need: "потрібен інсектицид", key: "insecticide_bottles", unit: "шт", verb: "оприскати" },
};

export function NoSupply({ kind, ctx, onClose, onBought }) {
  const k = KIND[kind];
  const [pack, setPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bottom = useStageBottom(16);
  const host = document.querySelector(".app") ?? document.body;

  useEffect(() => {
    api.get("/shop").then((s) => setPack((s.coins ?? []).find((i) => i.code === kind) ?? null)).catch(() => {});
  }, [kind]);

  const balance = (ctx.me?.balances?.silver ?? 0) + (ctx.me?.balances?.yellow ?? 0);
  const have = ctx.me?.care?.[k?.key] ?? 0;

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/shop/buy", { code: kind });
      await ctx.refreshMe();
      onBought();
    } catch (e) {
      if (e.body?.error === "not_enough") {
        // Замість рядка «не вистачає» — той самий попап зі способами
        // дібрати монети, що й у крамниці.
        onClose();
        ctx.notify(<NotEnoughCoins what={`${pack.title} · ${pack.unit}`} price={pack.price} have={balance} ctx={ctx}
                                   onClose={() => ctx.notify(null)} />);
        return;
      }
      setError(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="care-card" style={{ bottom }}>
        <div className="care-card-head">
          <img src={`/assets/ui/${k.src}.png`} alt="" style={{ width: Math.round(44 * k.ratio), height: 44 }} />
          <b>Не вистачає {k.of}</b>
        </div>
        <p>{error ?? `Кавенятку ${k.need}, щоб рости далі. У запасі зараз ${have} ${k.unit}.`}</p>
        {pack && (
          <>
            <div className="care-card-row care-pack">
              {/* Назва з самого товару: «Вода · 5 л», а не вигадана «Пачка
                  5 л» (зауваження власника 23.09.2026). */}
              <b>{pack.title} · {pack.unit}</b>
              <span><Coins2 />{fmt(pack.price)}</span>
            </div>
            <div className="care-card-balance">
              <span>Баланс <span className="coins2">
                <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 16, height: 17 }} />
                <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 16, height: 17, marginLeft: -7 }} />
              </span></span>
              <b>{fmt(balance)} → {fmt(Math.max(0, balance - pack.price))}</b>
            </div>
          </>
        )}
        <div className="care-card-btns wide">
          <button onClick={onClose}>Пізніше</button>
          <button disabled={busy || !pack} onClick={buy}>{busy ? "Купуємо…" : `Купити й ${k.verb}`}</button>
        </div>
      </div>
    </>,
    host
  );
}
