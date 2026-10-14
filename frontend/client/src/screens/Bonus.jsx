// «Попап редіму бонусу»: QR з кіоска відкриває застосунок, і над
// «Покупками» висить картка — монети й предмет за покупку й акаунт, на який
// вони вже лягли.
//
// Бонус прив'язаний до чека, а не до гравця, тому забрати його може будь-хто,
// хто першим відкрив посилання: QR горить на екрані точки дві хвилини.
//
// Зараховуємо одразу, щойно попап відкрився (рішення власника 14.10.2026).
// Доти зарахування чекало на «Отримати», а заголовок із макета вже казав
// «Бонус зарахований» — і бонус губився: попап закривали, не натиснувши, а
// натиснуте, поки дані ще вантажились, тихо закривало попап із порожнім
// списком (власник, 14.10.2026, бонус #87). Тепер кнопка лише закриває
// попап, а баланс у шапці оновлюється саме тоді — монети летять з іконки.
import { useEffect, useRef, useState } from "react";
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
  const [state, setState] = useState(null);   // { coins, items } — уже зараховане
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(null);   // мережа підвела — «Спробувати ще»
  const [busy, setBusy] = useState(true);
  const enc = encodeURIComponent;

  const redeem = async () => {
    setBusy(true); setError(null); setRetry(null);
    const list = await Promise.all(tokens.map((t) => api.get(`/me/bonus/${enc(t)}`).then((s) => ({ t, s })).catch((e) => ({ t, e }))));
    const open = list.filter((x) => x.s && x.s.status !== "redeemed");
    for (const x of open) api.post(`/bonus/${enc(x.t)}/seen`, {}).catch(() => {});   // QR на точці більше не потрібен
    if (!open.length) {
      const first = list[0];
      const lost = !first?.s && !first?.e?.body?.error;   // не дійшли до api — бонус ще чекає
      setError(first?.s ? (first.s.mine ? ERRORS.already_yours : ERRORS.already_taken) : ERRORS[first?.e?.body?.error] ?? errText(first?.e));
      if (lost) setRetry(true); else onDone?.();
      setBusy(false);
      return;
    }
    const got = [];
    for (const x of open) {
      try { await api.post(`/me/bonus/${enc(x.t)}`); got.push(x); }
      catch (e) {
        const code = e.body?.error;
        if (code === "already_yours") got.push(x);   // повтор після обриву: уже наше
        else if (code !== "already_taken") { setError(ERRORS[code] ?? errText(e)); setRetry(true); setBusy(false); return; }
      }
    }
    onDone?.();
    if (!got.length) setError(ERRORS.already_taken);
    else setState({ coins: got.reduce((n, x) => n + (x.s.coins ?? 0), 0), items: got.flatMap((x) => x.s.items ?? []) });
    setBusy(false);
  };

  // Один раз на набір токенів: повторний запуск ефекту (StrictMode у dev,
  // перемонтування) побачив би щойно зараховане як «redeemed» і перетер би
  // «+39» на «Ти вже отримав цей бонус».
  const ran = useRef(null);
  useEffect(() => {
    const key = tokens.join(",");
    if (ran.current === key) return;
    ran.current = key;
    redeem();
  }, [tokens.join(",")]);

  // Монети вже на акаунті; кнопка лише показує їх у шапці — refreshMe, поки
  // попап ще на екрані, тож вони летять з іконки нагороди (markCoinSource).
  const close = async () => {
    if (state) await ctx.refreshMe().catch(() => {});
    onClose();
  };
  const action = () => (busy ? null : retry ? redeem() : close());

  const items = state?.items ?? [];
  return (
    <ResultPopup title="Бонус зарахований" offset={96} gap={18}
                 action={busy ? "Отримуємо…" : retry ? "Спробувати ще" : error ? "Зрозуміло" : "Отримати"}
                 onAction={action} onClose={close}>
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
        {error ?? (state && <>Речі зараховано до акаунту <b>{ctx.me?.nickname}</b></>)}
      </div>
    </ResultPopup>
  );
}
