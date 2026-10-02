// «Історія транзакцій» (власник, 01.10.2026): простий список з журналу
// монет і зерен (ledger_entries, GET /me/ledger) — що, коли й на скільки
// змінився баланс. Без макета: рядки по днях, ліворуч — людська назва
// операції, праворуч — зміна кожної валюти.
import { useEffect, useState } from "react";
import { api, errText } from "../api.js";

const CARE = { water: "вода", compost: "компост", fertilizer: "добриво", insecticide: "інсектицид" };
// Одиниця — та сама, що на полиці й у Магазині: вода в літрах, компост і
// добриво в кілограмах. Досі тут для всього стояло «шт» — «вода · 5 шт».
const CARE_UNIT = { water: "л", compost: "кг", fertilizer: "кг", insecticide: "шт" };
const PRODUCT = { coffee_250g: "кава 250 г", merch_cup: "чашка з принтом", custom_print: "футболка з принтом" };

// Назва операції людською мовою — за причиною й тим, що лежить у meta.
function title(e) {
  const m = e.meta ?? {};
  const income = e.delta_yellow + e.delta_silver + e.delta_beans > 0;
  switch (e.reason) {
    case "purchase":
      if (m.bonus_grant_id) return "Бонус за каву";
      if (m.pack) return "Набір монет";
      if (m.item) return e.item_name ? `Одяг «${e.item_name}»` : "Одяг у Магазині";
      return "Покупка";
    case "quiz": return m.quiz === "profile" ? "Анкета «Розкажи про себе»" : "Опитування про напій";
    case "repost": return "Пост у соцмережі";
    case "crate": return income ? "Монети зі скриньки" : "Щаслива скринька";
    case "care": return CARE[m.pack] ? `Препарат: ${CARE[m.pack]}` : "Препарати для кавенятка";
    case "chat": return "Повідомлення в чаті";
    case "transfer": return m.to ? `Переказ для ${m.to}` : m.from ? `Переказ від ${m.from}` : "Переказ";
    case "market": return m.role === "seller" ? "Продаж на ринку" : "Купівля на ринку";
    case "exchange": return "Обмін зерен на монети";
    case "pos_discount": return m.refund ? "Повернення за знижку в кав'ярні" : "Знижка в кав'ярні";
    case "delivery": return PRODUCT[m.product] ? `Замовлення: ${PRODUCT[m.product]}` : "Замовлення";
    case "sapling": return "Саджанець";
    case "wardrobe_set": return "Подарований комплект одягу";
    case "harvest": return "Врожай кавенятка";
    case "admin": return income ? "Нарахування від extrovert.cafe" : "Списання від extrovert.cafe";
    default: return "Операція";
  }
}

// Підпис під назвою: час і, де є, подробиця.
function detail(e) {
  const m = e.meta ?? {};
  const time = new Date(e.created_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const extra = e.reason === "purchase" && m.uah ? `${m.uah} ₴`
    : e.reason === "market" && m.commission ? `комісія ${m.commission}`
    : e.reason === "care" && m.amount ? `${m.amount} ${CARE_UNIT[m.pack] ?? "шт"}`
    : null;
  return extra ? `${time} · ${extra}` : time;
}

const CURRENCIES = [
  ["delta_yellow", "/assets/ui/coin_gold.webp", "жовті монети"],
  ["delta_silver", "/assets/ui/coin_silver.webp", "срібні монети"],
  ["delta_beans", "/assets/ui/bean.webp", "зерна"],
];

const dayOf = (iso) => new Date(iso).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

export function Transactions() {
  const [entries, setEntries] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async (before) => {
    setBusy(true);
    try {
      const r = await api.get(`/me/ledger${before ? `?before=${before}` : ""}`);
      setEntries((prev) => [...(before ? prev ?? [] : []), ...(r.entries ?? [])]);
      setMore(Boolean(r.more));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  if (error && !entries) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!entries) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!entries.length) return <div className="stage-pad"><div className="panel muted">Операцій ще немає. Тут з'являться бонуси за каву, покупки й перекази.</div></div>;

  // Групуємо за днями в тому порядку, як прийшли (від найновішого).
  const days = [];
  for (const e of entries) {
    const d = dayOf(e.created_at);
    if (days.at(-1)?.day !== d) days.push({ day: d, list: [] });
    days.at(-1).list.push(e);
  }

  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      {days.map(({ day, list }) => (
        <div className="tx-day" key={day}>
          <div className="sectionTitle">{day}</div>
          <div className="tx-list">
            {list.map((e) => (
              <div className="tx-row" key={e.id}>
                <span className="tx-main">
                  <b>{title(e)}</b>
                  <small>{detail(e)}</small>
                </span>
                <span className="tx-deltas">
                  {CURRENCIES.filter(([k]) => e[k]).map(([k, src, alt]) => (
                    <span key={k} data-plus={e[k] > 0 || undefined}>
                      {e[k] > 0 ? "+" : "−"}{Math.abs(e[k])}
                      <img src={src} alt={alt} />
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="short-note" style={{ color: "var(--accent-text)" }}>{error}</div>}
      {more && (
        <button className="cta wide ghost" disabled={busy} onClick={() => load(entries.at(-1).id)}>
          {busy ? "…" : "Показати старіші"}
        </button>
      )}
    </div>
  );
}
