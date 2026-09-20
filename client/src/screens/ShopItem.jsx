// Прев'ю товару з Магазину: препарат, саджанець, обмін, знижка на POS або
// річ із доставкою. Скринька має власний екран (шанси, анімація), решта
// різниться лише текстом і тим, що робить кнопка, — тому один компонент.
import { useState } from "react";
import { api } from "../api.js";

const COIN = { yellow: "/assets/ui/coin_gold.png", beans: "/assets/ui/bean.png" };

// Пояснення під товаром: чому саме ця покупка має сенс. Тексти з дизайну
// (екрани «Прев'ю…»), а не вигадані на місці.
const ABOUT = {
  water: [
    "Відро спільне на всіх кавенят: один літр — один полив.",
    "Полив не рухає стадію (крім найпершої), зате лікує сум і в'янення.",
  ],
  compost: ["Компост потрібен на переходах до листя й гілок — двох найпомітніших змін вигляду."],
  fertilizer: ["Добриво йде на бутони: саме воно перетворює здоровий кущ на квітучий."],
  insecticide: ["Інсектицид потрібен ближче до врожаю — і на тих переходах, де кавенятко саме обирає, чого хоче."],
  sapling: [
    "Крихітний паросток на власній платформі. Ім'я, характер і зовнішність — усе з нуля: жодне кавенятко не виростає таким, як попереднє.",
    "Росте паралельно з рештою й хоче свій догляд. Склад, відро й поличка спільні на всіх — препарати ділиш між кавенятками сам.",
  ],
  sapling_beans: [
    "Той самий саджанець, але за зерна — якщо монети шкода, а зерна вже є.",
  ],
  pos_discount: [
    "Код одноразовий і діє обмежений час: бери його перед самою покупкою на точці.",
    "Код приходить у чат кавенятка, щоб не загубився.",
  ],
  beans_to_coins: [
    "Обмін односторонній: монети назад у зерна не перетворюються.",
    "Зерна варті більше — обмінюй, лише коли монети потрібні тут і зараз.",
  ],
};

const DONE = {
  care: (r) => `Додано ${r.added}. Тепер на поличці ${r.have}.`,
  sapling: () => "Саджанець твій — знайди його на головному екрані.",
  exchange: (r) => `Обміняно ${r.beans} на ${r.coins} монет.`,
  pos_discount: (r) => `Код ${r.code} на ${r.amount_uah} грн. Він уже в чаті кавенятка.`,
  item: (r) => `«${r.name}» на складі.`,
};

export function ShopItem({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  if (!item) return null;
  const delivery = item.kind === "delivery";
  const about = ABOUT[item.code] ?? [];

  const buy = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/shop/buy", body ?? { code: item.code });
      await ctx.refreshMe();
      setDone(DONE[r.kind]?.(r) ?? "Готово.");
    } catch (e) {
      setError(e.body?.error === "not_enough" ? "not_enough" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const balance = item.currency === "beans" ? ctx.me?.balances?.beans ?? 0
    : (ctx.me?.balances?.yellow ?? 0) + (ctx.me?.balances?.silver ?? 0);

  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center" }}>
        <img src={`/${item.icon}`} alt="" style={{ width: 120, height: 120, objectFit: "contain", margin: "0 auto" }} />
        <div className="h2" style={{ marginTop: 10 }}>{item.title}</div>
        <p className="muted" style={{ margin: 0 }}>{item.subtitle}</p>
      </div>

      {about.length > 0 && (
        <div className="panel">
          {about.map((line) => (
            <p key={line} className="muted" style={{ fontSize: 13, lineHeight: 1.45, margin: "0 0 8px" }}>{line}</p>
          ))}
        </div>
      )}

      {delivery && (
        <div className="panel">
          <div className="h2">Доставка</div>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Їде Новою Поштою у відділення або поштомат. Місто, відділення й розмір обираються на чекауті,
            а статус приходить у чат кавенятка.
          </p>
        </div>
      )}

      {done ? (
        <div className="panel" style={{ borderColor: "var(--accent)" }}>
          <div style={{ fontWeight: 800 }}>{done}</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={ctx.pop}>Готово</button>
        </div>
      ) : (
        <>
          {error === "not_enough" && (
            <div className="panel row" style={{ gap: 10, borderColor: "var(--accent)" }}>
              <img src={COIN[item.currency]} alt="" style={{ width: 24 }} />
              <div className="muted" style={{ flex: 1, fontSize: 12.5 }}>
                {item.currency === "beans"
                  ? `Не вистачає зерен: треба ${item.price}, є ${balance}. Зерна дає врожай і подарований комплект.`
                  : `Не вистачає монет: треба ${item.price}, є ${balance}.`}
              </div>
              {item.currency !== "beans" && (
                <button className="btn btn-primary" style={{ width: "auto", padding: "0 14px", height: 38 }}
                        onClick={() => ctx.push("coinPacks")}>Поповнити</button>
              )}
            </div>
          )}
          {error && error !== "not_enough" && (
            <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>
          )}

          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="price" style={{ fontSize: 18 }}>
              {item.price}<img src={COIN[item.currency]} alt="" />
              {item.gives_coins ? <span className="muted" style={{ fontWeight: 400 }}>→ {item.gives_coins} монет</span> : null}
            </span>
            <button className="btn btn-primary" style={{ width: "auto", padding: "0 26px" }} disabled={busy}
                    onClick={() => (delivery ? ctx.push("checkout", { item }) : buy())}>
              {busy ? "Купуємо…" : delivery ? "Оформити доставку" : "Купити"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
