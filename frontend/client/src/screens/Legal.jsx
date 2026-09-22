// Умови й приватність — кадри «Умови користування» і «Політика
// приватності»: дві пігулки-вкладки, суцільний текст, редакція внизу.
// Посилання «підтримка» в тексті й унизу ведуть одразу в Telegram-бот.
// Тексти приходять з api (backend/api/data/legal), щоб нова редакція не
// вимагала релізу застосунку.
import { useEffect, useState } from "react";
import { api } from "../api.js";

// Іконки валют у тексті, як у макеті: у даних вони записані токенами
// {coins} і {beans}, а посилання на підтримку — {support:текст}.
const Coins = () => (
  <span className="doc-coins">
    <img src="/assets/ui/coin_silver.png" alt="срібні монети" />
    <img src="/assets/ui/coin_gold.png" alt="золоті монети" />
  </span>
);
const Beans = () => <img className="doc-bean" src="/assets/ui/bean.png" alt="кавові зерна" />;

function Rich({ text, onSupport }) {
  const [head, ...rest] = text.split("{");
  return (
    <p>
      {head}
      {rest.map((chunk, i) => {
        const end = chunk.indexOf("}");
        const [name, label] = chunk.slice(0, end).split(":");
        const tail = chunk.slice(end + 1);
        const token = name === "coins" ? <Coins />
          : name === "beans" ? <Beans />
          : <button className="doc-link" onClick={onSupport}>{label}</button>;
        return <span key={i}>{token}{tail}</span>;
      })}
    </p>
  );
}

export function Legal({ doc = "terms", ctx }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/legal/${doc}`).then(setData).catch(() => setData(null));
  }, [doc]);

  // Вкладки підміняють екран: назад — туди, звідки прийшли.
  const open = (next) => () => ctx.replace(next);
  const toSupport = () => ctx.support?.();

  return (
    <div className="form18">
      <div className="pill-tabs">
        <button aria-pressed={doc === "terms"} onClick={open("terms")}>Умови</button>
        <button aria-pressed={doc === "privacy"} onClick={open("privacy")}>Приватність</button>
      </div>

      {!data ? (
        <div className="skeleton" />
      ) : (
        <div className="doc">
          {data.sections.map((sec) => [
            <h3 key={sec.heading}>{sec.heading}</h3>,
            ...sec.paragraphs.map((p, i) => <Rich key={`${sec.heading}-${i}`} text={p} onSupport={toSupport} />),
          ])}
          <div className="doc-foot">
            Редакція від {data.updated} · <button className="doc-link" onClick={toSupport}>підтримка</button>
          </div>
        </div>
      )}
    </div>
  );
}
