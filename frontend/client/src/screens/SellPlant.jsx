// «Продати кавенятко» — кадр «P2P · продаж кавенятка»: картка з мініатюрою,
// ціна в монетах або зернах, комісія й мінімум, як працює продаж і
// «Виставити на маркет».
//
// Комісія на кавенят менша, ніж на одяг: це рідкісна угода на великі суми,
// і десятина з неї виглядала б як штраф за продаж.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PlantView } from "../plant/PlantView.jsx";
import { plural } from "../ui/plural.js";

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);
const Gold = ({ w = 14, h = 15 }) => <img src="/assets/ui/coin_gold.png" alt="золоті монети" style={{ width: w, height: h }} />;
const Bean = ({ w = 12, h = 14 }) => <img src="/assets/ui/bean.png" alt="кавові боби" style={{ width: w, height: h }} />;

export function SellPlant({ plant, ctx }) {
  const [currency, setCurrency] = useState("yellow");
  const [price, setPrice] = useState("1800");
  const [wardrobe, setWardrobe] = useState(null);
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/me/plants/${plant.id}/wardrobe`).then(setWardrobe).catch(() => setWardrobe(null));
    api.get("/market/rules").then(setRules).catch(() => setRules({}));
  }, [plant.id]);

  const pct = rules?.commission_pct?.plant ?? 2;
  const min = rules?.min_price ?? { yellow: 10, beans: 2 };
  const value = Math.trunc(Number(price) || 0);
  const commission = Math.round((value * pct) / 100);

  const appearance = plant.appearance ?? {};
  const skins = new Set([...(appearance.leaves_bg ?? []), ...(appearance.leaves_fg ?? [])].map((l) => l.skin)).size;
  const branches = (appearance.branches ?? []).length;
  const sets = (wardrobe?.ready?.length ?? 0) + (wardrobe?.set?.gifted ? 1 : 0);
  const facts = [`Стадія ${plant.growth_stage}`, sets ? `${sets} ${plural(sets, "повний комплект", "повні комплекти", "повних комплектів")}` : null].filter(Boolean).join(" · ");
  const look = [skins ? `${skins} ${plural(skins, "скін", "скіни", "скінів")} листя` : null, branches ? `${branches} ${plural(branches, "гілка", "гілки", "гілок")}` : null].filter(Boolean).join(" · ");

  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/market/listings", { kind: "plant", plant_id: plant.id, price: value, currency });
      ctx.pop();
    } catch (e) {
      const code = e.body?.error;
      setError(code === "last_plant" ? "Це твоє єдине кавенятко – спершу заведи ще одне"
        : code === "already_listed" ? "Кавенятко вже на маркеті"
        : code === "price_too_low" ? `Мінімальна ціна – ${min[currency]}`
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const Coin = currency === "beans" ? Bean : Gold;
  return (
    <div className="stage-pad" style={{ gap: 14 }}>
      <div className="sell-card">
        <div className="sell-plant">
          <PlantView plant={plant} worn={plant.worn} width={68} height={84} fit="stage" />
        </div>
        <div className="lot-body">
          <b className="sell-name">{plant.name || "Без імені"}</b>
          <small className="sell-stock">{facts}</small>
          {look && <small className="sell-stock">{look}</small>}
        </div>
      </div>

      <div className="field" style={{ gap: 10 }}>
        <div className="sectionTitle">Ціна</div>
        <div className="seg">
          <button data-on={currency === "yellow"} onClick={() => setCurrency("yellow")}><Gold w={16} h={17} /></button>
          <button data-on={currency === "beans"} onClick={() => setCurrency("beans")}><Bean w={15} h={17} /></button>
        </div>
        <label className="sell-price">
          <input inputMode="numeric" value={value ? fmt(value) : ""} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
          <span>комісія {pct}% · {fmt(commission)} <Coin /></span>
        </label>
        <div className="sell-note">Мінімальна ціна – {min.yellow} <Gold w={13} h={14} /> або {min.beans} <Bean />.</div>
      </div>

      <div className="why sell">
        <b>Як працює продаж</b>
        <p>Кавенятко піде до покупця в тому одязі, який ти йому подарував. Те, що просто примірялось, повернеться на склад.</p>
        <p>Поки кавенятко на маркеті, доглядати за ним неможливо – але й сумувати воно не буде. Якщо ти знімеш його з продажу, все піде далі, як було.</p>
        <p>Твій лот показують поруч із тим самим товаром від кафе, і чим дешевший він за сусідів, тим частіше його бачать покупці. Якщо хочеш, щоб купили швидко, став ціну в нижній частині діапазону і дешевше, ніж продає кафе.</p>
      </div>

      {error && <div className="sell-note" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" style={{ marginTop: "auto", height: 52 }} disabled={busy || value < min[currency]} onClick={list}>
        Виставити на маркет
      </button>
    </div>
  );
}
