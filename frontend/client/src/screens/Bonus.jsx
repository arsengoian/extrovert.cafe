// «Попап редіму бонусу»: QR з кіоска відкриває застосунок, і над
// «Покупками» висить картка — монети й предмет за покупку, на чий акаунт
// вони ляжуть, «Забрати».
//
// Бонус прив'язаний до чека, а не до гравця, тому забрати його може будь-хто,
// хто першим відкрив посилання: QR горить на екрані точки дві хвилини.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { ItemIcon } from "../ui/ItemIcon.jsx";

const ERRORS = {
  already_taken: "Цей бонус уже забрали",
  already_yours: "Ти вже забрав цей бонус",
  expired: "Бонус згорів – QR діє дві хвилини",
  no_such_bonus: "Такого бонусу немає",
};

export function BonusPopup({ token, ctx, onClose }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/me/bonus/${encodeURIComponent(token)}`)
      .then((s) => {
        setState(s);
        if (s.status === "redeemed") setError(s.mine ? ERRORS.already_yours : ERRORS.already_taken);
        else if (s.expired) setError(ERRORS.expired);
      })
      .catch((e) => setError(ERRORS[e.body?.error] ?? e.body?.error ?? e.message));
  }, [token]);

  const take = async () => {
    if (error) return onClose();
    setBusy(true);
    try {
      await api.post(`/me/bonus/${encodeURIComponent(token)}`);
      await ctx.refreshMe();
      onClose();
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const item = state?.items?.[0];
  return (
    <ResultPopup title="Бонус зарахований" offset={96} gap={18} action={error ? "Зрозуміло" : busy ? "Забираємо…" : "Забрати"}
                 onAction={take} onClose={onClose}>
      {state && (
        <div className="loot">
          <div className="loot-tile">
            <span><img src="/assets/ui/coin_gold.png" alt="золоті монети" /></span>
            <b>+{state.coins}</b>
          </div>
          {item && (
            <div className="loot-tile">
              <span className={`tier-${item.tier}`}>
                <ItemIcon sprite={item.sprite_id} size={66} alt={`${item.name} «${item.collection}»`} style={{ width: 66 }} />
              </span>
              <small>{item.name}{item.collection && <><br />«{item.collection}»</>}</small>
            </div>
          )}
        </div>
      )}
      <div className="loot-note">
        {error ?? <>Речі зараховано до акаунту <b>{ctx.me?.nickname}</b></>}
      </div>
    </ResultPopup>
  );
}
