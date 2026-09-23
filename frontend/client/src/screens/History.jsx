// Покупки — за макетом «Gamification Screens», кадр «Покупки кави»: банер
// доступних опитувань, заголовок із підсумком і картка на кожен напій —
// з картинкою, часом, ціною, монетами за нього й опитуванням саме про нього.
// Картка — на напій, а не на чек: гравець пам'ятає «лате в понеділок», а
// не номер чека. Бонусний напій — окрема підсвічена картка з лутдропом.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ItemIcon } from "../ui/ItemIcon.jsx";
import { plural } from "../ui/plural.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);
const dayOf = (d) => d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
const timeOf = (d) => d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });

const Check = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M5 12.5 10 17.5 19.5 7" />
  </svg>
);

export function History({ ctx }) {
  const [data, setData] = useState(null);
  const [quiz, setQuiz] = useState({ credits: 0, reward: 40 });

  useEffect(() => {
    api.get("/me/history").then(setData).catch(() => setData({ receipts: [], totals: { drinks: 0, coins: 0 } }));
    api.get("/quiz/drink").then((r) => setQuiz({ credits: r.credits ?? 0, reward: r.reward ?? 40 })).catch(() => {});
    // ctx.rev — щоб щойно забраний бонус з'явився тут одразу, без
    // перемикання вкладок.
  }, [ctx.rev]);

  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Дата як у кадрі: сьогодні — жирна й з часом, учора — з часом, старші —
  // лише число.
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 864e5));
  // Монети за чек приписуємо першому напою — розбивати їх по позиціях нема
  // з чого, а двічі показувати ту саму суму неправда.
  const orders = data.receipts.flatMap((r) => {
    const at = new Date(r.fiscal_date);
    const base = { point: r.point_name, at, items: r.bonus_items ?? [] };
    if (!r.items.length) return [{ ...base, key: `r${r.id}`, name: "Замовлення", sum: r.total_sum, coins: r.bonus_coins }];
    return r.items.map((it, i) => ({
      ...base,
      key: `r${r.id}-${it.id}`,
      item: it,
      name: it.name,
      sum: it.sum,
      coins: i === 0 ? r.bonus_coins : 0,
      items: it.is_bonus ? base.items : [],
    }));
  });
  const { drinks, coins } = data.totals ?? { drinks: orders.length, coins: 0 };

  return (
    <div className="stage-pad">
      {quiz.credits > 0 && (
        <div className="credit-banner">
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
          <div>
            {/* «Кредит» — наше внутрішнє слово, і на екрані воно нічого не
                пояснює (зауваження власника 23.09.2026). */}
            <b>Тобі доступно {quiz.credits} {plural(quiz.credits, "опитування", "опитування", "опитувань")}</b> – пройди його про будь-яке замовлення нижче
          </div>
        </div>
      )}

      <div className="orders-head">
        <h1>Замовлення кави</h1>
        <span>
          {drinks} {plural(drinks, "напій", "напої", "напоїв")} · {fmt(coins)}
          <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
        </span>
      </div>

      {orders.length === 0 && (
        <div className="panel muted">
          Тут будуть покупки кави: кожен напій з автомата й монети, які ти за нього отримав.
        </div>
      )}

      <div className="orders">
        {orders.map((o) => {
          const bonus = Boolean(o.item?.is_bonus);
          const date = dayOf(o.at);
          return (
            <div className="order" key={o.key} data-bonus={bonus || undefined}>
              <div className="order-top">
                <img src={o.item?.sprite ? `/assets/drinks/${o.item.sprite}.png` : "/assets/ui/coffee250.png"} alt="" />
                <div className="order-main">
                  <b>{o.name}</b>
                  <small>
                    {date === today ? <em>{date}</em> : date}
                    {(date === today || date === yesterday) && `, ${timeOf(o.at)}`} · {fmt(o.sum)} ₴
                  </small>
                  {bonus && <strong>Бонусний напій</strong>}
                </div>
                <div className="order-badges">
                  {o.coins > 0 && (
                    <div className="coin-badge">
                      <span><img src="/assets/ui/coin_gold.png" alt="золоті монети" /></span>
                      <b>+{o.coins}</b>
                    </div>
                  )}
                  {o.items.map((it) => (
                    <div className="coin-badge item" key={it.code}>
                      <span className={`tier-${it.tier}`}>
                        <ItemIcon sprite={it.sprite_id} size={38} alt={`${it.name} «${it.collection}»`} style={{ width: 38 }} />
                      </span>
                      <small>{it.name}</small>
                    </div>
                  ))}
                </div>
              </div>
              {o.item && !bonus && (o.item.answered ? (
                <div className="order-done">
                  {/* Перед нагородою — широкий пробіл U+2003, як у макеті. */}
                  <Check />Опитування пройдено{" "}+{quiz.reward} <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
                </div>
              ) : quiz.credits > 0 && (
                <button className="order-cta" onClick={() => ctx.push("quizDrink", { item: { ...o.item, fiscal_date: o.at.toISOString(), point_name: o.point } })}>
                  Пройти опитування +{quiz.reward} <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {orders.length > 0 && (
        <div className="orders-note">Кредити на опитування нараховуються на 1-му, 4-му й далі кожному 10-му напої</div>
      )}
    </div>
  );
}
