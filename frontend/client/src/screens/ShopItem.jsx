// Превʼю товару з Магазину — кадри «Превʼю саджанця», «Превʼю води» і
// «Превʼю товару за зерна»: сцена 170 px, заголовок із чипом праворуч,
// пояснення й кнопка ціни. Скринька й одяг мають власні екрани, решта
// різниться сценою, текстом і тим, що робить кнопка, — тому один компонент.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";
import { BuyConfirm } from "../ui/BuyConfirm.jsx";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";
import { beans as beansText, coins as coinsText } from "../ui/plural.js";
import { Img, webp } from "../ui/img.jsx";

const Bean = ({ w = 17, h = 19 }) => <img src="/assets/ui/bean.webp" alt="зерна" style={{ width: w, height: h }} />;
const Coins2 = () => (
  <span className="coins2">
    <img src="/assets/ui/coin_silver.webp" alt="срібні монети" style={{ width: 20, height: 21 }} />
    <img src="/assets/ui/coin_gold.webp" alt="золоті монети" style={{ width: 20, height: 21, marginLeft: -6 }} />
  </span>
);

// Пояснення під товаром — тексти з макета, де кадр є; для решти — у тому
// ж тоні й довжині.
const ABOUT = {
  water: [
    "Полив потрібен саджанцю, щоб рушити в ріст, і далі – щоб кавенятко не сумувало. Без води три дні воно засумує, а потім зів'яне.",
    "Один полив миттєво повертає звичний вигляд навіть із зів'ялого стану, і прогрес росту не втрачається.",
  ],
  compost: ["Компост потрібен на переходах до листя й гілок – двох найпомітніших змін вигляду."],
  fertilizer: ["Добриво йде на бутони: саме воно перетворює здоровий кущ на квітучий."],
  insecticide: ["Інсектицид потрібен ближче до врожаю: кавенятко може його попросити, щоб виростити бутони, розцвісти та виростити боби."],
  sapling: [
    "Крихітний паросток на власній платформі. Ім'я, характер і зовнішність – усе з нуля: жодне кавенятко не виростає таким, як попереднє.",
    "Кожне кавеня росте паралельно з рештою й хоче свій догляд. Твої склад, відро й поличка спільні для всіх.",
  ],
  beans_to_coins: [
    "Кавові боби можна обміняти на монети. Але обережно! Назад обміняти уже не можна, тому використовуй цю функцію лише коли монети потрібні терміново.",
  ],
};
ABOUT.sapling_beans = ABOUT.sapling;
// Кава 250 г — історія пачки (власник, 01.10.2026). Що саме в купажі й від
// якого обсмажувальника — внутрішня кухня, гравцю цього не пишемо.
ABOUT.coffee_250g = [
  "Подорож цієї кави починається на іншому континенті – на зелених пагорбах Уганди, де екваторіальне сонце, теплі дощі й червона земля дають зерну щільність і глибокий, впевнений смак.",
  "Звідти зелене зерно вирушає в довгу дорогу через океан і кордони, його обсмажують невеликими партіями – уважно й з любовʼю – і пакують, поки аромат на піку.",
  "Насичена, з шоколадною гірчинкою й цитрусовим післясмаком, вона однаково добра і сама по собі, і з молоком. А найприємніше – ця пачка виросла з твоїх зерен.",
];

// Тіри одягу для «Як дістати зерна»: комплект платить за найслабшою річчю.
const TIERS = [["common", "Common"], ["uncommon", "Uncommon"], ["rare", "Rare"], ["epic", "Epic"]];
// Знижка — рівно стільки гривень, скільки в economy.json, а не «≈». І без
// коду: на обраній точці ціни ненадовго падають, а напій купується як
// завжди (власник, 27.09.2026). Поки автомат не вміє швидко міняти ціни,
// купити її не можна — і текст каже це прямо.
ABOUT.pos_discount = (item) => [
  `Рівно ${item.amount_uah} ₴ знижки на кожен напій у кав'ярні (але не дешевше гривні). Купуй, коли стоїш біля автомата: за кілька секунд ціни на ньому стануть нижчими на ${Math.round((item.window_s ?? 120) / 60)} хв або до першого чека, а на екрані піде відлік.`,
  // Ціни доїжджають за кілька секунд, і напій, пробитий раніше, піде за
  // повною ціною (власник, 28.09.2026).
  "Перш ніж купувати напій, дочекайся, поки знижка з'явиться на екрані кавомашини й на головному екрані кав'ярні, – тоді знижені ціни вже діють.",
  "Знижка діє для першого, хто купить у цей час, – тож не тягни. Якщо знижені ціни не доїдуть до автомата, зерна повернуться самі.",
  ...(item.available ? [] : ["Поки що купити не можна: автомат ще не вміє швидко міняти ціни. Щойно навчиться – знижка відкриється тут, а доти зерна не списуються."]),
];

// Чашка й футболка друкуються з кавенятка гравця — «тільки твоє». Раніше
// це була плашка на вітрині під плитками, а на самій чашці стояло сухе «з
// принтом extrovert.cafe» (власник, 27.09.2026).
const UNIQUE = {
  merch_cup: "Кожна чашка неповторна.",
  custom_print: "Кожна футболка неповторна.",
};
function Unique({ code }) {
  return (
    <div className="unique">
      <span className="unique-badge">тільки твоє</span>
      <p>Принт малюється з твого кавенятка – з його одягом, скінами й плодами на момент замовлення. {UNIQUE[code]}</p>
    </div>
  );
}

// Обмін — будь-яка кількість зерен, аж до всіх (власник, 27.09.2026).
// Число можна і натискати, і вписати; «Максимум» — усе, що на рахунку.
function ExchangePicker({ amount, setAmount, have, rate }) {
  const max = Math.max(1, have);
  const clamp = (n) => Math.max(1, Math.min(max, Number.isFinite(n) ? Math.floor(n) : 1));
  return (
    <div className="exch">
      <div className="exch-head">
        <b>Скільки обміняти</b>
        <span>у тебе {have} <Bean w={14} h={16} /></span>
      </div>
      <div className="exch-row">
        <button className="exch-step" aria-label="менше" disabled={amount <= 1} onClick={() => setAmount(clamp(amount - 1))}>−</button>
        <label className="exch-val">
          <input inputMode="numeric" value={amount} disabled={have < 1} aria-label="кількість зерен"
                 onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setAmount(d ? Math.min(max, Number(d)) : ""); }}
                 onBlur={() => setAmount(clamp(Number(amount)))} />
          <Bean w={17} h={19} />
        </label>
        <button className="exch-step" aria-label="більше" disabled={amount >= max} onClick={() => setAmount(clamp(Number(amount) + 1))}>+</button>
        <button className="exch-max" data-on={amount === max && have > 0} disabled={have < 1} onClick={() => setAmount(max)}>Максимум</button>
      </div>
      <div className="exch-sum">
        Ти отримаєш <b>{coinsText((Number(amount) || 0) * rate)}</b>
        <img src="/assets/ui/coin_gold.webp" alt="" style={{ width: 17, height: 18 }} />
      </div>
    </div>
  );
}

// Скільки вже є — чип праворуч від назви, як «у відрі 2 л» у макеті.
const STOCK = {
  water: (c) => `у відрі ${c.water_liters} л`,
  compost: (c) => `на поличці ${c.compost_kg} кг`,
  fertilizer: (c) => `на поличці ${c.fertilizer_kg} кг`,
  insecticide: (c) => `на поличці ${c.insecticide_bottles} шт`,
};

const UNIT = { water: "л", compost: "кг", fertilizer: "кг", insecticide: "шт" };

const DONE = {
  // Скільки додалось — з одиницею; скільки тепер усього, видно на полиці
  // (власник, 27.09.2026: «Додано 3 кг», без «тепер на поличці»).
  care: (r, item) => `Додано ${r.added} ${UNIT[item?.code] ?? ""}`.trim(),
  sapling: () => "Саджанець твій – знайди його на головному екрані.",
  exchange: (r) => `Обміняно ${beansText(r.beans)} на ${coinsText(r.coins)}.`,
  // Діє — одразу; інша знижка на точці ще йде — стає в чергу за нею
  // (власник, 28.09.2026).
  pos_discount: (r) => (r.status === "active"
    ? `Знижку ввімкнено: ${r.amount_uah} ₴ з кожного напою в кав'ярні${r.point_name ? ` ${r.point_name}` : ""} на ${Math.round((r.seconds ?? 120) / 60)} хв або до першого чека. Дочекайся, поки знижка з'явиться на екрані кавомашини й на головному екрані кав'ярні, – і тоді купуй: ціни вже будуть нижчими.`
    : `Знижка стала в чергу: зараз у кав'ярні вже діє інша. Твоя почнеться, щойно скінчиться ${r.ahead > 1 ? `${r.ahead} попередніх` : "попередня"}, і так само діятиме ${Math.round((r.seconds ?? 120) / 60)} хв або до першого чека. Купуй напій, коли знижка з'явиться на екрані кавомашини й на головному екрані кав'ярні.`),
};

function Hero({ item }) {
  if (item.kind === "sapling") {
    return (
      <div className="shop-hero sky">
        <Img className="platform" src="/assets/ui/platform.png" sizes="222px" alt="" />
        <img className="sprout" src="/assets/ui/sprout.webp" alt="паросток" />
      </div>
    );
  }
  const water = item.code === "water";
  return (
    <div className={`shop-hero${water ? " water" : item.kind === "care" ? " care" : ""}`}>
      <img src={webp(`/${item.icon}`)} alt="" style={water ? { transform: "scaleX(-1)" } : undefined} />
    </div>
  );
}

export function ShopItem({ item, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sapling, setSapling] = useState(null);
  const [amount, setAmount] = useState(1);
  // Що підтверджуємо: кнопка з ціною відкриває попап, а не купує одразу
  // (власник, 01.10.2026).
  const [confirm, setConfirm] = useState(null);

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
      const r = await api.post("/shop/buy", target.kind === "exchange"
        ? { code: target.code, amount: Math.max(1, Number(amount) || 1) }
        : { code: target.code });
      await ctx.refreshMe();
      const close = () => ctx.notify(null);
      ctx.pop();
      ctx.notify(
        <ResultPopup art={<img src={webp(`/${target.icon}`)} alt="" style={{ width: 62, height: 62, objectFit: "contain" }} />}
                     title="Готово" onClose={close}>
          <div className="result-note">{DONE[r.kind]?.(r, target) ?? "Покупка вже твоя."}</div>
        </ResultPopup>
      );
    } catch (e) {
      if (e.body?.error === "not_enough" && target.currency !== "beans") {
        ctx.notify(<NotEnoughCoins what={item.title} price={target.price} have={coinsHave} ctx={ctx} onClose={() => ctx.notify(null)} />);
      } else {
        setError(e.body?.error === "not_enough" ? `Не вистачає зерен: треба ${target.price}, є ${beansHave}` : errText(e));
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const ask = (target = item) => setConfirm(target);

  const chip = delivery
    ? <span className="shop-chip price"><Bean w={20} h={22} />{item.price_range ? item.price_range.join("-") : item.price}</span>
    : STOCK[item.code] && ctx.me?.care ? <span className="shop-chip">{STOCK[item.code](ctx.me.care)}</span> : null;
  const exchange = item.kind === "exchange";
  const lack = exchange ? 0 : Math.max(0, item.price - beansHave);
  const about = typeof ABOUT[item.code] === "function" ? ABOUT[item.code](item) : ABOUT[item.code] ?? [];

  return (
    <div className="quiz">
      <Hero item={item} />

      <div className="shop-head">
        <div className="preview-head">
          <h2>{item.unit ? `${item.title} (${item.unit})` : item.title}</h2>
          {item.subtitle && <p>{item.subtitle}</p>}
        </div>
        {chip}
      </div>

      {UNIQUE[item.code] && <Unique code={item.code} />}

      {delivery ? (
        <>
          {about.length > 0 && (
            <div className="item-text">
              {about.map((line) => <div key={line}>{line}</div>)}
            </div>
          )}
          <div className="how">
            <b>Як це працює</b>
            <p><Bean /> списуються одразу після підтвердження. Далі – доставка Новою Поштою у відділення або поштомат; статус видно в «Моїх замовленнях».</p>
            <div className="how-balance">
              <span>Твій баланс</span>
              <b>{beansHave} <Bean />{lack > 0 ? `, не вистачає ${lack}` : ""}</b>
            </div>
          </div>
          {/* Лише коли зерен не вистачає (власник, 01.10.2026): тому, хто вже
              може замовити, підказка «як дістати» ні до чого. */}
          {lack > 0 && (
            <div className="earn-beans">
              <div className="sectionTitle">Як дістати <Bean w={15} h={16} /></div>
              <div><b>+{item.earn?.harvest ?? 7}</b> виростити кавенятко до 10 стадії</div>
              <div className="earn-set">
                <span>подарувати дорослому кавенятку повний комплект одягу – за найслабшою річчю в ньому:</span>
                <span className="earn-tiers">
                  {TIERS.map(([tier, label]) => (
                    <span key={tier} className={`tier-${tier}`}><b>+{item.earn?.set_by_tier?.[tier] ?? "?"}</b> <em className="tier-text">{label}</em></span>
                  ))}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="item-text">
          {about.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}

      {exchange && <ExchangePicker amount={amount} setAmount={setAmount} have={beansHave} rate={item.gives_coins ?? 15} />}

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <div className="buy-row">
        {delivery ? (
          <button className="cta" disabled={lack > 0} onClick={() => ctx.push("checkout", { item })}>
            Замовити за {item.price} <Bean w={18} h={20} />
          </button>
        ) : item.kind === "sapling" ? (
          // Акцентна — кнопка тієї валюти, за яку саджанець відкрили: із
          // зерен у Магазині — зерна, з монет — монети (власник, 28.09.2026).
          // Раніше акцентними завжди були монети.
          <>
            <button className={item.currency === "beans" ? "cta ghost" : "cta"} disabled={busy || !sapling} onClick={() => ask(sapling.coins)}>
              <Coins2 />{sapling?.coins?.price ?? "…"}
            </button>
            <button className={item.currency === "beans" ? "cta" : "cta ghost"} disabled={busy || !sapling} onClick={() => ask(sapling.beans)}>
              <Bean w={19} h={21} />{sapling?.beans?.price ?? "…"}
            </button>
          </>
        ) : exchange ? (
          <button className="cta" disabled={busy || beansHave < 1} onClick={() => ask()}>
            {beansHave < 1 ? "Зерен поки немає" : <>Обміняти {Number(amount) || 1} <Bean w={19} h={21} /></>}
          </button>
        ) : item.available === false ? (
          <button className="cta" disabled>Скоро на точці</button>
        ) : item.currency === "beans" ? (
          <button className="cta" disabled={busy || lack > 0} onClick={() => ask()}>
            <Bean w={19} h={21} />{item.price}
          </button>
        ) : (
          <button className="cta" disabled={busy} onClick={() => ask()}>
            <Coins2 />{item.price}
          </button>
        )}
      </div>

      {confirm && (() => {
        const t = confirm;
        const ex = t.kind === "exchange";
        const qty = Math.max(1, Number(amount) || 1);
        return (
          <BuyConfirm art={<img src={webp(`/${t.icon}`)} alt="" style={{ width: 120, height: 120, objectFit: "contain" }} />}
                      /* Скільки монет дасть обмін — у самій назві: рядка під назвою більше немає. */
                      title={ex ? `Обмін на ${coinsText(qty * (item.gives_coins ?? 15))}` : t.unit ? `${t.title} (${t.unit})` : t.title}
                      price={ex ? qty : t.price} currency={ex || t.currency === "beans" ? "beans" : "coins"}
                      balances={b} busy={busy} onCancel={() => setConfirm(null)} onBuy={() => buy(t)}
                      cta={ex ? "Обміняти" : undefined} />
        );
      })()}
    </div>
  );
}
