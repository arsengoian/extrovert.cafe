// Превʼю товару з Магазину — кадри «Превʼю саджанця», «Превʼю води» і
// «Превʼю товару за зерна»: сцена 170 px, заголовок із чипом праворуч,
// пояснення й кнопка ціни. Скринька й одяг мають власні екрани, решта
// різниться сценою, текстом і тим, що робить кнопка, — тому один компонент.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";

const Bean = ({ w = 17, h = 19 }) => <img src="/assets/ui/bean.png" alt="зерна" style={{ width: w, height: h }} />;
const Coins2 = () => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" style={{ width: 20, height: 21 }} />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
  </span>
);

// Пояснення під товаром — тексти з макета, де кадр є; для решти — у тому
// ж тоні й довжині.
const ABOUT = {
  water: [
    "Полив потрібен саджанцю, щоб рушити в ріст, і далі – щоб кавенятко не сумувало. Без води три дні воно поникне, а потім зів'яне.",
    "Один полив миттєво повертає звичний вигляд навіть із зів'ялого стану, і прогрес росту не втрачається.",
  ],
  compost: ["Компост потрібен на переходах до листя й гілок – двох найпомітніших змін вигляду."],
  fertilizer: ["Добриво йде на бутони: саме воно перетворює здоровий кущ на квітучий."],
  insecticide: ["Інсектицид потрібен ближче до врожаю – і на тих переходах, де кавенятко саме обирає, чого хоче."],
  sapling: [
    "Крихітний паросток на власній платформі. Ім'я, характер і зовнішність – усе з нуля: жодне кавенятко не виростає таким, як попереднє.",
    "Росте паралельно з рештою й хоче свій догляд. Склад, відро й поличка спільні на всіх – препарати ділиш між кавенятками сам.",
  ],
  pos_discount: [
    "Код одноразовий і діє обмежений час: бери його перед самою покупкою на точці.",
    "Код приходить у чат кавенятка, щоб не загубився.",
  ],
  beans_to_coins: [
    "Обмін односторонній: монети назад у зерна не перетворюються.",
    "Зерна варті більше – обмінюй, лише коли монети потрібні тут і зараз.",
  ],
};
ABOUT.sapling_beans = ABOUT.sapling;

// Скільки вже є — чип праворуч від назви, як «у відрі 2 л» у макеті.
const STOCK = {
  water: (c) => `у відрі ${c.water_liters} л`,
  compost: (c) => `на поличці ${c.compost_kg} кг`,
  fertilizer: (c) => `на поличці ${c.fertilizer_kg} кг`,
  insecticide: (c) => `на поличці ${c.insecticide_bottles} пл.`,
};

const DONE = {
  care: (r) => `Додано ${r.added}. Тепер на поличці ${r.have}.`,
  sapling: () => "Саджанець твій – знайди його на головному екрані.",
  exchange: (r) => `Обміняно ${r.beans} на ${r.coins} монет.`,
  pos_discount: (r) => `Код ${r.code} на ${r.amount_uah} грн. Він уже в чаті кавенятка.`,
};

function Hero({ item }) {
  if (item.kind === "sapling") {
    return (
      <div className="shop-hero sky">
        <img className="platform" src="/assets/ui/platform.png" alt="" />
        <img className="sprout" src="/assets/ui/sprout.png" alt="паросток" />
      </div>
    );
  }
  const water = item.code === "water";
  return (
    <div className={`shop-hero${water ? " water" : item.kind === "care" ? " care" : ""}`}>
      <img src={`/${item.icon}`} alt="" style={water ? { transform: "scaleX(-1)" } : undefined} />
    </div>
  );
}

export function ShopItem({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sapling, setSapling] = useState(null);

  // Саджанець продається і за монети, і за зерна — у макеті обидві ціни
  // на одному превʼю, звідки б гравець не прийшов.
  useEffect(() => {
    if (item?.kind !== "sapling") return;
    api.get("/shop").then((s) => setSapling({
      coins: s.coins.find((i) => i.code === "sapling"),
      beans: s.beans.find((i) => i.code === "sapling_beans"),
    })).catch(() => {});
  }, [item?.code]);

  if (!item) return null;
  const b = ctx.me?.balances ?? {};
  const delivery = item.kind === "delivery";
  const beansHave = b.beans ?? 0;
  const coinsHave = (b.silver ?? 0) + (b.yellow ?? 0);

  const buy = async (target = item) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/shop/buy", { code: target.code });
      await ctx.refreshMe();
      const close = () => ctx.notify(null);
      ctx.pop();
      ctx.notify(
        <ResultPopup art={<img src={`/${target.icon}`} alt="" style={{ width: 62, height: 62, objectFit: "contain" }} />}
                     title="Готово" onClose={close}>
          <div className="result-note">{DONE[r.kind]?.(r) ?? "Покупка вже твоя."}</div>
        </ResultPopup>
      );
    } catch (e) {
      if (e.body?.error === "not_enough" && target.currency !== "beans") {
        ctx.notify(<NotEnoughCoins what={item.title} price={target.price} have={coinsHave} ctx={ctx} onClose={() => ctx.notify(null)} />);
      } else {
        setError(e.body?.error === "not_enough" ? `Не вистачає зерен: треба ${target.price}, є ${beansHave}` : e.body?.error ?? e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const chip = delivery
    ? <span className="shop-chip price"><Bean w={20} h={22} />{item.price_range ? item.price_range.join("-") : item.price}</span>
    : STOCK[item.code] && ctx.me?.care ? <span className="shop-chip">{STOCK[item.code](ctx.me.care)}</span> : null;
  const lack = Math.max(0, item.price - beansHave);

  return (
    <div className="quiz">
      <Hero item={item} />

      <div className="shop-head">
        <div className="preview-head">
          <h2>{item.unit ? `${item.title} · ${item.unit}` : item.title}</h2>
          <p>{item.subtitle}</p>
        </div>
        {chip}
      </div>

      {delivery ? (
        <>
          <div className="how">
            <b>Як це працює</b>
            <p><Bean /> списуються одразу після підтвердження. Далі – доставка Новою Поштою у відділення або поштомат; статус видно в «Моїх замовленнях».</p>
            <div className="how-balance">
              <span>Твій баланс <Bean w={15} h={17} /></span>
              <b>{beansHave} <Bean />{lack > 0 ? ` · не вистачає ${lack}` : ""}</b>
            </div>
          </div>
          <div className="earn-beans">
            <div className="sectionTitle">Як дістати <Bean w={15} h={16} /></div>
            <div><b>+7</b> виростити кавенятко до 10 стадії</div>
            <div><b>+3…9</b> подарувати кавенятку набір одягу</div>
          </div>
        </>
      ) : (
        <div className="item-text">
          {(ABOUT[item.code] ?? []).map((line) => <div key={line}>{line}</div>)}
        </div>
      )}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="buy-row">
        {delivery ? (
          <button className="cta" disabled={lack > 0} onClick={() => ctx.push("checkout", { item })}>
            Замовити за {item.price} <Bean w={18} h={20} />
          </button>
        ) : item.kind === "sapling" ? (
          <>
            <button className="cta" disabled={busy || !sapling} onClick={() => buy(sapling.coins)}>
              <Coins2 />{sapling?.coins?.price ?? "…"}
            </button>
            <button className="cta ghost" disabled={busy || !sapling} onClick={() => buy(sapling.beans)}>
              <Bean w={19} h={21} />{sapling?.beans?.price ?? "…"}
            </button>
          </>
        ) : item.currency === "beans" ? (
          <button className="cta" disabled={busy || lack > 0} onClick={() => buy()}>
            <Bean w={19} h={21} />{item.price}
          </button>
        ) : (
          <button className="cta" disabled={busy} onClick={() => buy()}>
            <Coins2 />{item.price}
          </button>
        )}
      </div>
    </div>
  );
}
