// Чекаут для товарів за зерна: розмір, місто, відділення, отримувач.
//
// Місто й відділення шукаються в локальній копії довідника НП — швидко й
// без ключа НП у браузері. Поштомати, у які товар не влазить, API не
// повертає взагалі й каже, скільки їх сховав: інакше гравець шукав би той,
// що «був учора».
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Sheet } from "../ui/Sheet.jsx";
import { beans as beansWord } from "../ui/plural.js";

const KIND = { branch: "відділення", postomat: "поштомат" };

export function Checkout({ item, ctx }) {
  const productId = item?.code;
  const [product, setProduct] = useState(null);
  const [size, setSize] = useState(null);
  const [city, setCity] = useState(null);
  const [warehouse, setWarehouse] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+380");
  const [picker, setPicker] = useState(null);       // city | warehouse | sizes
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get(`/shop/products/${productId}`).then((p) => {
      setProduct(p);
      if (p.options?.size) setSize(p.options.size[1] ?? p.options.size[0]);
    }).catch((e) => setError(e.body?.error ?? e.message));
  }, [productId]);

  if (error && !product) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!product) return <div className="stage-pad"><div className="skeleton" /></div>;

  if (done) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src={`/${item.icon}`} alt="" style={{ width: 80, margin: "6px auto 10px" }} />
          <div className="h2">Замовлення прийнято</div>
          <p className="muted">
            {product.name} поїде на {done.address}. Статус приходитиме в чат кавенятка.
          </p>
          <button className="btn btn-primary" onClick={() => { ctx.pop(); ctx.push("orders"); }}>Мої замовлення</button>
        </div>
      </div>
    );
  }

  const order = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/me/redemptions", {
        product: productId,
        options: size ? { size } : {},
        recipient_name: name.trim(),
        recipient_phone: phone,
        warehouse_ref: warehouse.ref,
      });
      await ctx.refreshMe();
      setDone(r);
    } catch (e) {
      const code = e.body?.error;
      setError(code === "not_enough" ? `Не вистачає зерен: треба ${e.body.need}`
        : code === "bad_phone" ? "Телефон у форматі +380XXXXXXXXX"
        : code === "bad_name" ? "Вкажи імʼя й прізвище"
        : code ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = warehouse && name.trim().length >= 3 && /^\+?\d{10,13}$/.test(phone) && (!product.options?.size || size);

  return (
    <div className="stage-pad">
      <div className="panel row" style={{ gap: 12 }}>
        <img src={`/${item.icon}`} alt="" style={{ width: 52, height: 52, objectFit: "contain" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{product.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {product.packed.length_cm}×{product.packed.width_cm}×{product.packed.height_cm} см · {product.packed.weight_kg} кг
          </div>
        </div>
        <span className="price">{product.price_beans}<img src="/assets/ui/bean.png" alt="зерен" /></span>
      </div>

      {product.options?.size && (
        <>
          <div className="row-between" style={{ margin: "18px 4px 8px" }}>
            <span className="sectionTitle" style={{ margin: 0 }}>Розмір</span>
            <button className="muted" style={{ fontSize: 12, textDecoration: "underline" }}
                    onClick={() => setPicker("sizes")}>таблиця розмірів</button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {product.options.size.map((s) => (
              <button key={s} className="btn" style={{ flex: 1, height: 40, fontSize: 13,
                ...(size === s ? { background: "var(--grad)", color: "var(--accent-ink)", border: 0 } : {}) }}
                      onClick={() => setSize(s)}>{s}</button>
            ))}
          </div>
        </>
      )}

      <div className="sectionTitle">Куди</div>
      <button className="panel row-between" style={{ width: "100%" }} onClick={() => setPicker("city")}>
        <span style={{ fontWeight: 700 }}>{city?.name ?? "Обрати місто"}</span>
        <span className="muted">›</span>
      </button>
      <button className="panel row-between" style={{ width: "100%" }} disabled={!city}
              onClick={() => setPicker("warehouse")}>
        <span style={{ fontWeight: 700, textAlign: "left" }}>
          {warehouse ? warehouse.description : city ? "Обрати відділення" : "Спершу місто"}
        </span>
        <span className="muted">›</span>
      </button>

      <div className="sectionTitle">Отримувач</div>
      <div className="panel" style={{ display: "grid", gap: 8 }}>
        <input className="price-input" style={{ fontSize: 15 }} value={name} placeholder="Імʼя та прізвище"
               onChange={(e) => setName(e.target.value.slice(0, 60))} />
        <input className="price-input" style={{ fontSize: 15 }} value={phone} inputMode="tel"
               onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 13))} />
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Доставку оплачує отримувач при отриманні. Імʼя й телефон їдуть у Нову Пошту й більше нікуди.
      </p>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="btn btn-primary" disabled={!ready || busy} onClick={order}>
        {busy ? "Оформлюємо…" : `Замовити за ${beansWord(product.price_beans)}`}
      </button>

      {picker === "sizes" && (
        <Sheet title="Таблиця розмірів" onClose={() => setPicker(null)}>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            Виміряй обхват грудей і поділи на два — це напівобхват (A). Щоб футболка сиділа вільно,
            додай 2–5 см. Довжина (B) — від плеча до нижнього краю.
          </p>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            {Object.entries(product.size_chart_cm ?? {}).map(([s, v]) => (
              <button key={s} className="row-between" style={{ width: "100%", padding: "10px 12px" }}
                      onClick={() => { setSize(s); setPicker(null); }}>
                <span style={{ fontWeight: 800 }}>{s}</span>
                <span className="muted" style={{ fontSize: 13 }}>ширина {v.width} см · довжина {v.length} см</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {picker === "city" && (
        <CityPicker onClose={() => setPicker(null)} onPick={(c) => { setCity(c); setWarehouse(null); setPicker("warehouse"); }} />
      )}

      {picker === "warehouse" && city && (
        <WarehousePicker city={city} product={productId} onClose={() => setPicker(null)}
                         onPick={(w) => { setWarehouse(w); setPicker(null); }} />
      )}
    </div>
  );
}

function CityPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [cities, setCities] = useState([]);

  useEffect(() => {
    if (q.trim().length < 2) { setCities([]); return undefined; }
    const timer = setTimeout(() => {
      api.get(`/np/cities?q=${encodeURIComponent(q.trim())}`).then((r) => setCities(r.cities)).catch(() => setCities([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <Sheet title="Місто" onClose={onClose}>
      <input className="price-input" style={{ width: "100%", fontSize: 15 }} value={q} placeholder="Почни вводити"
             onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 10 }}>
        {cities.map((c) => (
          <button key={c.ref} className="row-between" style={{ width: "100%", padding: "10px 4px" }} onClick={() => onPick(c)}>
            <span style={{ fontWeight: 700 }}>{c.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>{c.area}</span>
          </button>
        ))}
        {q.trim().length >= 2 && cities.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>Нічого не знайшли. Перевір написання.</p>
        )}
      </div>
    </Sheet>
  );
}

function WarehousePicker({ city, product, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.get(`/np/warehouses?city=${encodeURIComponent(city.ref)}&product=${product}&q=${encodeURIComponent(q.trim())}`)
        .then(setData).catch(() => setData({ warehouses: [], hidden_postomats: 0 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [city.ref, product, q]);

  return (
    <Sheet title={`Відділення · ${city.name}`} onClose={onClose}>
      <input className="price-input" style={{ width: "100%", fontSize: 15 }} value={q} placeholder="Номер або вулиця"
             onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 10 }}>
        {!data && <div className="skeleton" />}
        {data?.warehouses.map((w) => (
          <button key={w.ref} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 4px" }}
                  onClick={() => onPick(w)}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{w.description}</div>
            <div className="muted" style={{ fontSize: 12 }}>{KIND[w.category] ?? w.category}</div>
          </button>
        ))}
        {data?.warehouses.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Нічого не знайшли.</p>}
      </div>
      {data?.hidden_postomats > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Сховано поштоматів: {data.hidden_postomats} — посилка в їхні комірки не влізе.
        </p>
      )}
    </Sheet>
  );
}
