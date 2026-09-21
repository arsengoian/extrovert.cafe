// Покупки — за макетом «Gamification Screens», кадр «Покупки кави»: банер
// кредиту на опитування, заголовок із підсумком і картка на кожен напій —
// з картинкою, часом, ціною й монетами за нього. Картка — на напій, а не
// на чек: гравець пам'ятає «лате в понеділок», а не номер чека.
import { useEffect, useState } from "react";
import { api } from "../api.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);
const when = (iso) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
};

export function History({ ctx }) {
  const [receipts, setReceipts] = useState(null);
  const [sprites, setSprites] = useState({});
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    api.get("/me/history").then((r) => setReceipts(r.receipts)).catch(() => setReceipts([]));
    // Картинка напою — з каталога за system_code: у чеку її немає.
    api.get("/catalog/drinks")
      .then((r) => setSprites(Object.fromEntries((r.drinks ?? r).map((d) => [d.system_code, d.sprite]))))
      .catch(() => {});
    api.get("/quiz/drink").then((r) => setCredits(r.credits ?? 0)).catch(() => {});
  }, []);

  if (!receipts) return <div className="stage-pad"><div className="skeleton" /></div>;

  // Один чек — зазвичай один напій; бонусний напій окремою карткою не
  // показуємо, він частина того самого замовлення.
  const orders = receipts.flatMap((r) => {
    const drinks = r.items.filter((it) => !it.is_bonus);
    if (!drinks.length) {
      return [{ key: `r${r.id}`, name: "Замовлення", sum: r.total_sum, at: r.fiscal_date, coins: r.bonus_coins, sprite: null }];
    }
    return drinks.map((it, i) => ({
      key: `r${r.id}-${i}`,
      name: it.name,
      sum: it.sum,
      at: r.fiscal_date,
      // Монети за чек приписуємо першому напою — розбивати їх по позиціях
      // нема з чого, а двічі показувати ту саму суму неправда.
      coins: i === 0 ? r.bonus_coins : 0,
      sprite: sprites[it.system_code] ?? null,
    }));
  });
  const totalCoins = receipts.reduce((s, r) => s + (r.bonus_coins ?? 0), 0);

  return (
    <div className="stage-pad">
      {credits > 0 && (
        <div className="credit-banner">
          <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
          <div>
            <b>{credits} кредит на опитування</b> – пройди його про будь-яке замовлення нижче
          </div>
        </div>
      )}

      <div className="orders-head">
        <h1>Замовлення кави</h1>
        <span>
          {orders.length} {orders.length === 1 ? "напій" : orders.length < 5 ? "напої" : "напоїв"} · {fmt(totalCoins)}
          <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
        </span>
      </div>

      {orders.length === 0 && (
        <div className="panel muted">
          Тут будуть покупки кави: кожен напій з автомата й монети, які ти за нього забрав.
        </div>
      )}

      {orders.map((o) => {
        const { date, time } = when(o.at);
        return (
          <div className="order" key={o.key}>
            <div className="order-top">
              <img src={o.sprite ? `/assets/drinks/${o.sprite}.png` : "/assets/ui/coffee250.png"} alt="" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{o.name}</b>
                <small><em>{date}</em>, {time} · {fmt(o.sum)} ₴</small>
              </div>
              {o.coins > 0 && (
                <div className="coin-badge">
                  <span><img src="/assets/ui/coin_gold.png" alt="золоті монети" /></span>
                  <b>+{o.coins}</b>
                </div>
              )}
            </div>
            {credits > 0 && (
              <button className="order-cta" onClick={() => ctx.push("quizDrink")}>
                Пройти опитування +40 <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
