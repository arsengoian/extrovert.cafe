// «Попап редіму бонусу»: QR з кіоска відкриває застосунок, і над
// «Покупками» висить картка — монети й предмет за покупку, на чий акаунт
// вони ляжуть, «Отримати».
//
// Бонус прив'язаний до чека, а не до гравця, тому забрати його може будь-хто,
// хто першим відкрив посилання: QR горить на екрані точки дві хвилини.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { Sparks, markCoinSource } from "../ui/fx.jsx";

const ERRORS = {
  already_taken: "Цей бонус уже забрали",
  already_yours: "Ти вже отримав цей бонус",
  no_such_bonus: "Такого бонусу немає",
};

// tokens — кілька бонусів разом: ті, що гість накопичив до входу
// (bonusStash.js), плюс щойно відскановані. Показуємо суму монет і всі
// предмети, «Отримати» зараховує кожен; уже забрані просто пропускаємо.
export function BonusPopup({ tokens, ctx, onClose, onDone }) {
  const [state, setState] = useState(null);
  const [live, setLive] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const enc = encodeURIComponent;

  useEffect(() => {
    Promise.all(tokens.map((t) => api.get(`/me/bonus/${enc(t)}`).then((s) => ({ t, s })).catch((e) => ({ t, e }))))
      .then((list) => {
        const open = list.filter((x) => x.s && x.s.status !== "redeemed");
        for (const x of open) api.post(`/bonus/${enc(x.t)}/seen`, {}).catch(() => {});   // QR на точці більше не потрібен
        setLive(open.map((x) => x.t));
        if (!open.length) {
          const first = list[0];
          setError(first?.s ? (first.s.mine ? ERRORS.already_yours : ERRORS.already_taken) : ERRORS[first?.e?.body?.error] ?? errText(first?.e));
          onDone?.();
          return;
        }
        setState({
          coins: open.reduce((n, x) => n + (x.s.coins ?? 0), 0),
          items: open.flatMap((x) => x.s.items ?? []),
        });
      });
  }, [tokens.join(",")]);

  const take = async () => {
    if (error) return onClose();
    setBusy(true);
    try {
      for (const t of live) {
        try { await api.post(`/me/bonus/${enc(t)}`); }
        catch (e) { if (!["already_yours", "already_taken"].includes(e.body?.error)) throw e; }
      }
      onDone?.();
      await ctx.refreshMe();
      onClose();
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? errText(e));
    } finally {
      setBusy(false);
    }
  };

  const items = state?.items ?? [];
  return (
    <ResultPopup title="Бонус зарахований" offset={96} gap={18} action={error ? "Зрозуміло" : busy ? "Отримуємо…" : "Отримати"}
                 onAction={take} onClose={onClose}>
      {state && (
        <div className="loot">
          <div className="loot-tile">
            <span className="fx-pop"><img ref={markCoinSource} src="/assets/ui/coin_gold.webp" alt="золоті монети" /></span>
            <b>+{state.coins}</b>
          </div>
          {items.map((item, n) => (
            <div key={`${item.code ?? item.name}-${n}`} className="loot-tile">
              <span className={`tier-${item.tier} fx-pop`} style={{ position: "relative", animationDelay: `${120 + n * 80}ms` }}>
                <ItemIcon sprite={item.sprite_id} size={66} alt={`${item.name} «${item.collection}»`} style={{ width: 66 }} />
                <Sparks kind={item.tier} x="50%" y="50%" delay={370 + n * 80} />
              </span>
              <small>{item.name}{item.collection && <><br />«{item.collection}»</>}</small>
            </div>
          ))}
        </div>
      )}
      <div className="loot-note">
        {error ?? <>Речі зараховано до акаунту <b>{ctx.me?.nickname}</b></>}
      </div>
    </ResultPopup>
  );
}
