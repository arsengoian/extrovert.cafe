// Чекаут за зерна — кадр «Чекаут · Нова Пошта»: товар із залишком після
// оплати, розмір (таблиця — окремим екраном), доставка, отримувач, місто,
// відділення чи поштомат. Місто й відділення обираються у шторках
// «Вибір міста» і «Вибір відділення».
//
// Довідник НП — локальна копія на сервері: швидко й без ключа НП у
// браузері. Поштомати, у які товар не влазить, api не повертає взагалі.
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, errText } from "../api.js";
import { NotEnoughBeans } from "../ui/NotEnough.jsx";
import { PlantView } from "../plant/PlantView.jsx";
import { uploadPrint } from "../plant/print.js";
import { preferSelected } from "../plant/selected.js";
import { webp } from "../ui/img.jsx";

const KIND_TITLE = { branch: "Відділення", postomat: "Поштомат" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Таблиця розмірів — окремий екран, тож форма переживає перехід туди й
// назад у чернетці, а не в стані компонента, який тим часом розмонтовано.
const drafts = new Map();

const Bean = ({ w = 17, h = 19 }) => <img src="/assets/ui/bean.webp" alt="зерна" style={{ width: w, height: h }} />;
const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" style={{ flex: "none" }}>
    <path d="M6 9.5 12 15.5 18 9.5" />
  </svg>
);

// Телефон будь-якої країни (власник, 01.10.2026), а не лише +380. Цифри
// номера: «0671234567» — це український номер без коду, як його зазвичай і
// пишуть, тож дописуємо 38.
const phoneDigits = (raw) => {
  let d = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(d)) d = `38${d}`;
  return d.slice(0, d.startsWith("380") ? 12 : 15);
};
// Український — групами, як у макеті: «+380 67 123 45 67». Будь-який інший —
// «+» і цифри підряд: довжину коду країни (1–3 цифри) з цифр не вгадати, а
// трійки робили з «+48 512…» «+485 12…».
const formatPhone = (raw) => {
  const d = phoneDigits(raw);
  if (d.startsWith("380")) {
    const n = d.slice(3, 12);
    return `+380 ${[n.slice(0, 2), n.slice(2, 5), n.slice(5, 7), n.slice(7, 9)].filter(Boolean).join(" ")}`.trimEnd();
  }
  return `+${d}`;
};
// Повний номер: український — рівно 12 цифр, інший — від 8 до 15 (E.164).
const phoneOk = (raw) => {
  const d = phoneDigits(raw);
  return d.startsWith("380") ? d.length === 12 : d.length >= 8 && d.length <= 15;
};

// Відділення в рядку: «Відділення №12» і «вул. Хрещатик, 22 · до 20:00».
const whTitle = (w) => `${KIND_TITLE[w.category] ?? "Відділення"} №${w.number}`;
const whSub = (w) => {
  const street = (w.address ?? w.description ?? "").replace(/^[^:]*:\s*/, "");
  const close = w.schedule?.[DAYS[new Date().getDay()]]?.split("-")[1];
  return close ? `${street}, до ${close}` : street;
};

export function Checkout({ item, ctx }) {
  const productId = item?.code;
  const [product, setProduct] = useState(null);
  const [form, setForm] = useState(() => drafts.get(productId) ?? {
    size: null, first: "", last: "", phone: "+380", city: null, kind: "branch", warehouse: null, plant: null,
  });
  // Чашка й футболка друкуються з кавенятка — гравець обирає, з якого.
  const [plants, setPlants] = useState(() => api.peek("/me/plants")?.plants ?? []);
  const [picker, setPicker] = useState(null);       // city | warehouse
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);         // print — малюємо й заливаємо принт
  const [error, setError] = useState(null);

  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    drafts.set(productId, next);
    return next;
  });

  // Друге замовлення не заповнюють з нуля: отримувач і відділення — з
  // попереднього (власник, 01.10.2026). Чернетка цієї форми важливіша.
  useEffect(() => {
    if (drafts.has(productId)) return;
    api.get("/me/redemptions/last").then(({ last }) => {
      if (!last) return;
      setForm((f) => {
        // Поки відповідь ішла, людина вже почала заповнювати — не чіпаємо.
        if (f.first || f.last || f.city || f.phone !== "+380") return f;
        const next = {
          ...f, first: last.first ?? "", last: last.last ?? "", phone: last.phone ?? "+380",
          kind: last.kind === "postomat" ? "postomat" : "branch", city: last.city, warehouse: last.warehouse,
        };
        drafts.set(productId, next);
        return next;
      });
    }).catch(() => {});
  }, [productId]);

  useEffect(() => {
    api.get("/me/plants").then((r) => setPlants(r.plants ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    api.get(`/shop/products/${productId}`).then((p) => {
      setProduct(p);
      if (p.options?.size && !form.size) set({ size: p.options.size[1] ?? p.options.size[0] });
    }).catch((e) => setError(errText(e)));
  }, [productId]);

  if (error && !product) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!product) return <div className="stage-pad"><div className="skeleton" /></div>;

  const beans = ctx.me?.balances?.beans ?? 0;
  const printable = Boolean(product.print_area_mm);
  // Кавенятко для принта: обране, а поки не обирали — те, що на головному екрані.
  const printPlant = printable ? plants.find((p) => p.id === form.plant) ?? preferSelected(plants) : null;
  const ready = form.warehouse && form.first.trim() && form.last.trim() && phoneOk(form.phone)
    && (!product.options?.size || form.size) && (!printable || printPlant);

  const order = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/me/redemptions", {
        product: productId,
        options: form.size ? { size: form.size } : {},
        recipient_name: `${form.first.trim()} ${form.last.trim()}`,
        recipient_phone: `+${phoneDigits(form.phone)}`,
        warehouse_ref: form.warehouse.ref,
        print_plant_id: printPlant?.id ?? null,
      });
      drafts.delete(productId);
      // PNG для друку малюємо тут же, з того самого кавенятка. Не вдалось —
      // замовлення вже оформлене, а картка замовлення домалює файл сама.
      if (r.print_upload_url && printPlant) {
        setStage("print");
        try {
          if (await uploadPrint(printPlant, r.print_upload_url)) await api.post(`/me/redemptions/${r.id}/print`);
        } catch { /* домалює картка замовлення */ }
      }
      await ctx.refreshMe();
      ctx.replace("orders");
    } catch (e) {
      const code = e.body?.error;
      if (code === "not_enough") {
        ctx.notify(<NotEnoughBeans what={product?.title ?? "Замовлення"} price={e.body.need}
                                   have={ctx.me?.balances?.beans ?? 0} ctx={ctx}
                                   onClose={() => ctx.notify(null)} />);
        setBusy(false);
        return;
      }
      setError(code === "bad_phone" ? "Перевір номер телефону: код країни й номер"
        : code === "bad_name" ? "Вкажи імʼя й прізвище"
        : code === "plant_required" ? "Обери кавенятко для принта"
        : code ?? e.message);
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const sizes = product.options?.size ?? [];

  return (
    <div className="stage-pad">
      <div className="co-product">
        <img src={webp(`/${item.icon}`)} alt="" />
        <div className="co-name">
          <b>{product.name}</b>
          <small>{item.subtitle}</small>
        </div>
        <div className="co-price">
          <b><Bean />{product.price_beans}</b>
          <small>лишиться {Math.max(0, beans - product.price_beans)}</small>
        </div>
      </div>

      {sizes.length > 0 && (
        <div className="field">
          <div className="sectionTitle">Розмір</div>
          <div className="co-sizes">
            <div className="segs sm">
              {sizes.map((s) => (
                <button key={s} aria-pressed={form.size === s} onClick={() => set({ size: s })}>{s}</button>
              ))}
            </div>
            <button className="co-link" onClick={() => ctx.push("sizeChart", {
              chart: product.size_chart_cm, selected: form.size, onPick: (s) => set({ size: s }),
            })}>таблиця розмірів</button>
          </div>
        </div>
      )}

      {printable && plants.length > 0 && (
        <div className="field">
          <div className="sectionTitle">Кавенятко на принт</div>
          <div className="co-plants">
            {plants.map((p) => (
              <button key={p.id} className="co-plant" aria-pressed={printPlant?.id === p.id} onClick={() => set({ plant: p.id })}>
                <PlantView plant={{ ...p, mood: "healthy" }} worn={p.worn} width={72} height={84} platform={false} pad={6} />
                <span>{p.name || "Без імені"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field" style={{ gap: 10 }}>
        <div className="sectionTitle">Доставка</div>
        <div className="co-np">
          <span><img src="/assets/ui/nova_poshta_mark.svg" alt="Нова Пошта" /></span>
          <div>
            <b>Нова Пошта</b>
            <small>
              {productId === "custom_print" || productId === "merch_cup" ? "Друк принта – тиждень, далі відправка. " : ""}Доставка оплачується при отриманні.
            </small>
          </div>
        </div>
      </div>

      <div className="co-row">
        <input className="co-input" value={form.first} placeholder="Імʼя" onChange={(e) => set({ first: e.target.value.slice(0, 30) })} />
        <input className="co-input" value={form.last} placeholder="Прізвище" onChange={(e) => set({ last: e.target.value.slice(0, 30) })} />
      </div>
      <input className="co-input" value={formatPhone(form.phone)} inputMode="tel" placeholder="+380 XX XXX XX XX"
             onChange={(e) => set({ phone: e.target.value })} />
      {/* Спершу — відділення чи поштомат, потім місто (власник, 01.10.2026):
          від типу залежить список у шторці, а місто обирають уже під нього. */}
      <div className="seg">
        {["branch", "postomat"].map((k) => (
          <button key={k} data-on={form.kind === k}
                  onClick={() => set({ kind: k, warehouse: form.warehouse?.category === k ? form.warehouse : null })}>
            {KIND_TITLE[k]}
          </button>
        ))}
      </div>

      <button className="co-input co-select" onClick={() => setPicker("city")}>
        <span className={form.city ? undefined : "muted"}>{form.city?.name ?? "Місто"}</span><Chevron />
      </button>

      <button className="co-input co-wh" data-picked={Boolean(form.warehouse)} disabled={!form.city} onClick={() => setPicker("warehouse")}>
        <span>
          <b>{form.warehouse ? whTitle(form.warehouse) : form.city ? `Обрати ${KIND_TITLE[form.kind].toLowerCase()}` : "Спершу місто"}</b>
          {form.warehouse && <small>{whSub(form.warehouse)}</small>}
        </span>
        <Chevron />
      </button>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className="cta wide" style={{ height: 52 }} disabled={!ready || busy} onClick={order}>
        {stage === "print" ? "Готуємо принт…" : busy ? "Оформлюємо…" : <>Замовити за {product.price_beans} <Bean w={18} h={20} /></>}
      </button>

      {picker === "city" && (
        <CityPicker current={form.city} onClose={() => setPicker(null)}
                    onPick={(c) => { set({ city: c, warehouse: null }); setPicker("warehouse"); }} />
      )}
      {picker === "warehouse" && form.city && (
        <WarehousePicker city={form.city} kind={form.kind} product={productId} current={form.warehouse}
                         onClose={() => setPicker(null)} onPick={(w) => { set({ warehouse: w }); setPicker(null); }} />
      )}
    </div>
  );
}

// Шторка вибору — картка на 12 px від країв сцени, як у кадрах «Вибір
// міста» і «Вибір відділення»: заголовок, пошук, список із радіо, кнопка.
function PickSheet({ title, placeholder, query, onQuery, action, onAction, onClose, children }) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    const stage = document.querySelector(".stage");
    if (!app || !stage) return;
    const a = app.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    setBox({ top: s.top - a.top + 12, bottom: a.bottom - s.bottom + 12 });
  }, []);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="pick-sheet" style={box ?? undefined} role="dialog" aria-label={title}>
        <div className="pick-head">
          <b>{title}</b>
          <button aria-label="Закрити" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
            </svg>
          </button>
        </div>
        <label className="pick-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
          </svg>
          <input value={query} placeholder={placeholder} onChange={(e) => onQuery(e.target.value)} />
        </label>
        <div className="pick-list">{children}</div>
        <button className="cta wide" disabled={!action} onClick={onAction}>{action ?? "Обрати"}</button>
      </div>
    </>,
    host
  );
}

function PickRow({ on, title, sub, onClick }) {
  return (
    <button className="pick-row" data-on={on || undefined} onClick={onClick}>
      <i />
      <span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
}

function CityPicker({ current, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [cities, setCities] = useState([]);
  const [chosen, setChosen] = useState(current);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.get(`/np/cities?q=${encodeURIComponent(q.trim())}`).then((r) => setCities(r.cities)).catch(() => setCities([]));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <PickSheet title="Місто" placeholder="Назва міста" query={q} onQuery={setQ} onClose={onClose}
               action={chosen ? `Обрати ${chosen.name}` : null} onAction={() => onPick(chosen)}>
      {cities.map((c) => (
        <PickRow key={c.ref} on={chosen?.ref === c.ref} title={c.name} sub={c.area} onClick={() => setChosen(c)} />
      ))}
      {q.trim().length >= 2 && cities.length === 0 && <p className="pick-empty">Нічого не знайшли. Перевір написання.</p>}
    </PickSheet>
  );
}

function WarehousePicker({ city, kind, product, current, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(current);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.get(`/np/warehouses?city=${encodeURIComponent(city.ref)}&product=${product}&q=${encodeURIComponent(q.trim())}`)
        .then(setData).catch(() => setData({ warehouses: [], hidden_postomats: 0 }));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [city.ref, product, q]);

  const list = (data?.warehouses ?? []).filter((w) => w.category === kind);
  return (
    <PickSheet title={`${KIND_TITLE[kind]}: ${city.name}`} placeholder="Номер або вулиця" query={q} onQuery={setQ}
               onClose={onClose} action={chosen ? `Обрати №${chosen.number}` : null} onAction={() => onPick(chosen)}>
      {list.map((w) => (
        <PickRow key={w.ref} on={chosen?.ref === w.ref} title={whTitle(w)} sub={whSub(w)} onClick={() => setChosen(w)} />
      ))}
      {data && list.length === 0 && <p className="pick-empty">Нічого не знайшли.</p>}
      {kind === "postomat" && data?.hidden_postomats > 0 && (
        <p className="pick-empty">Сховано поштоматів: {data.hidden_postomats} – посилка в їхні комірки не влізе.</p>
      )}
    </PickSheet>
  );
}
