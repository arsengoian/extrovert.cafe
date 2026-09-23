// Головний екран кавенятка — кадри «0 · Паросток» … «10 · Зів'яле»: небо,
// кущ, хмаринка з бажанням, репліка, поличка з препаратами, ім'я зверху й
// три дії знизу. Геометрія — з макета: сцена 1000×1300 у масштабі 0.26,
// поличка й хмаринка на тих самих місцях.
//
// Чого кущ хоче — каже сервер (plant.growth): таблиця переходів живе в
// economy.json, і другої її копії тут бути не має.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { usePlantAssets } from "../plant/assets.js";
import { buildScene } from "../plant/scene.js";
import { Scene } from "../plant/Scene.jsx";
import { NoSupply } from "../plant/NoSupply.jsx";
import { Sparks } from "../ui/fx.jsx";

// Хмаринка стоїть над верхівкою крони — у макеті її позиція своя на кожній стадії.
const CLOUD_AT = [[219, 199], [225, 183], [263, 106], [273, 83], [280, 68], [282, 55], [282, 45], [282, 37], [282, 30], [282, 23], [282, 17]];

// Бажання в хмаринці: картинка, її місце всередині хмаринки й підпис.
const WAITING_LINE = "Росту далі завтра – одна стадія на добу";

const WANT = {
  water: { src: "want_water", at: [29, 17.5, 24, 33], title: "Хоче води" },
  compost: { src: "want_compost", at: [19, 16, 44, 36], title: "Хоче компост" },
  fertilizer: { src: "want_fertilizer", at: [26.5, 14, 29, 40], title: "Хоче добриво" },
  insecticide: { src: "want_insecticide", at: [26.5, 12, 29, 44], title: "Хоче оприскування" },
  outfit: { src: "want_outfit", at: [20, 12, 42, 44], title: "Хоче одяг" },
  // Добовий гейт — теж бажання, тільки чекати: препарат тут не допоможе,
  // і замість «хоче компост» у хмаринці має стояти пісочний годинник.
  time: { src: "want_time", at: [26, 13, 30, 42], title: "Чекає доби між стадіями" },
};

// Поличка: місце кожного препарату, картинка повна/порожня й кільце з запасом.
const SHELF = [
  { kind: "water", key: "water_liters", title: "Лійка", unit: "л", box: [34, 82, 61, 49], ring: [-19, 41], mirror: true,
    full: ["bucket", 10, 1, 44, 49, "лійка"], empty: ["bucket_empty", 7, 1, 50, 49, "порожня лійка"] },
  { kind: "fertilizer", key: "fertilizer_kg", title: "Добриво", unit: "кг", box: [39, 146, 41, 47], ring: [-25, 37],
    full: ["mineral", 14, 0, 24, 47, "добриво"], empty: ["mineral_empty", 14, 0, 24, 47, "порожнє добриво"] },
  { kind: "insecticide", key: "insecticide_bottles", title: "Інсектицид", unit: "шт", box: [39, 205, 39, 49], ring: [-25, 36],
    full: ["insecticide", 14, 0, 22, 49, "інсектицид"], empty: ["insecticide_empty", 14, 0, 22, 49, "порожній інсектицид"] },
  { kind: "compost", key: "compost_kg", title: "Компост", unit: "кг", box: [31, 260, 55, 43], ring: [-17, 32], crop: true,
    full: ["compost", -1, -20, 38, 56, "компост"], empty: ["compost_empty", -1, -20, 39, 56, "порожній компост"] },
];

const PLANTING_TITLE = { leaves: "Посадка листя", branches: "Посадка гілок", buds: "Посадка бутонів" };

// Репліка — за стадією, як у макеті: кавенятко пояснює, навіщо йому саме
// цей препарат, а не просто називає його.
const WISH_LINE = [
  "Мене щойно посадили. Полий мене, будь ласка",
  "Дай компост – і піде листя",
  "Ще компосту – і вижену гілки",
  "Добриво – і будуть перші бутони",
  "Перший бутон є. Ще добрива – буде три",
  "Три бутони. Цього разу випало добриво – буде п'ять",
  "П'ять бутонів, і хтось гризе листя. Оприскай",
  "Сім бутонів. Оприскай – і я зацвіту",
  "Я цвіту. Оприскай, щоб квіти стали бобами",
  "Боби зелені. Ще оприскування – і достигнуть",
  "Боби достигли. Тепер одягни мене!",
];
const DRESSED_LINE = "Комплект на мені. Хочу ще один скін";
const SAD_LINE = "Три дні без поливу. Полий мене, будь ласка";
const WITHERED_LINE = "Мене не поливали тиждень. Води, будь ласка";
const EMPTY_LINE = "Поличка порожня. Купи хоч води – я хочу пити";
// Бочка статична (bush_graphics_customization §10.15 #17): тап лише каже, навіщо вона.
const BARREL_LINE = "Мої боби – мій скарб, але я охоче подарую їх в обмін на комплект одягу";

const Lock = ({ size, title }) => (
  <span className="plant-lock" title={title}>
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  </span>
);

// Полив (дошка «Анімації»): лійка нахиляється, з носика падають краплі, а
// число на кільці змінюється з легким підскоком — як і в решти препаратів.
function Shelf({ care, onApply, pour }) {
  const shown = useRef(care);
  useEffect(() => { shown.current = care; });
  return (
    <div className="shelf">
      <img className="shelf-board" src="/assets/ui/shelf.png" alt="Поличка з препаратами" />
      {SHELF.map((s) => {
        const n = care[s.key] ?? 0;
        const [src, x, y, w, h, alt] = n > 0 ? s.full : s.empty;
        const img = (
          <img src={`/assets/ui/${src}.png`} alt={alt}
               style={{ left: x, top: y, width: w, height: h, transform: s.mirror ? "scaleX(-1)" : undefined }} />
        );
        const pouring = s.kind === "water" && pour;
        const changed = (shown.current[s.key] ?? 0) !== n;
        return (
          <button key={s.key} className="shelf-item" title={s.title} onClick={() => onApply(s.kind)}
                  style={{ left: s.box[0], top: s.box[1], width: s.box[2], height: s.box[3] }}>
            {s.crop ? <span className="shelf-crop">{img}</span>
              : s.kind === "water" ? <span className="shelf-tilt" key={pour?.id ?? "still"} data-pour={pouring ? "" : undefined}>{img}</span>
              : img}
            {pouring && [0, 1, 2].map((i) => (
              <img key={`${pour.id}-${i}`} className="fx-drop" src="/assets/ui/droplet.png" alt=""
                   style={{ left: 4 + i * 5, top: 38, animationDelay: `${300 + i * 150}ms` }} />
            ))}
            <span className="shelf-ring" data-empty={n <= 0 || undefined} style={{ left: s.ring[0], top: s.ring[1] }}>
              <img src="/assets/ui/ring.png" alt="" />
              <span><b key={n} className={changed ? "fx-count" : undefined}>{n}</b><small>{s.unit}</small></span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Меню дій — кадр «Меню дій з кавенятком»: картка над кнопкою «…». Кавенятку
// на маркеті меню не відкривається — замість нього картка «Зняти з продажу»,
// тож тут рядок зняття завжди неактивний.
function ActionMenu({ onGift, onSell, onScythe }) {
  const row = (icon, title, sub, onClick, extra = {}) => (
    <button className="menu-row" onClick={onClick} disabled={extra.off} data-danger={extra.danger || undefined}>
      <span className="menu-ico">{icon}</span>
      <span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
  return (
    <div className="plant-menu">
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8.5V21" /><path d="M4.5 12.5h15V21h-15z" /><path d="M4.5 8.5h15v4h-15z" /><path d="M12 8.5S9.2 8.5 8 7.3a2.4 2.4 0 1 1 4-2.6" /><path d="M12 8.5s2.8 0 4-1.2a2.4 2.4 0 1 0-4-2.6" /></svg>,
        "Подарувати другу", "Переходить іншому користувачу з усім подарованим одягом", onGift)}
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.4v9.2" /><path d="M14.6 9.6c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.9.8-2.9 2 0 2.8 5.9 1.6 5.9 4.2 0 1.2-1.3 2-3 2-1.3 0-2.4-.5-3-1.3" /></svg>,
        "Продати на ринку", "Ціна в монетах або бобах, мінімум 10", onSell)}
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19h14" /><path d="M7 19c0-4.4 2.6-7.6 6-9" /><path d="M13 10c-3.6 1.6-4.4 5-4.4 9" /><path d="M17.5 5.5 20 3" /></svg>,
        "Зняти з продажу", "Кавенятко не виставлене", undefined, { off: true })}
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M7 7v12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8V7" /></svg>,
        "Скосити", "Ресурси не повертаються, подарований одяг зникає назавжди", onScythe, { danger: true })}
    </div>
  );
}

// Кадр «На продажу»: догляд і чат під замками, а знизу — чому й кнопка зняття.
function SaleCard({ plant, onDone }) {
  const [error, setError] = useState(null);
  const unlist = async () => {
    try { await api.del(`/market/listings/${plant.listing.id}`); onDone(); }
    catch (e) { setError(e.body?.error ?? e.message); }
  };
  return (
    <div className="sale-card">
      <p>{error ?? "Поки кавенятко на ринку, догляд і чат заблоковані, а настрій не показується. Якщо ти знімеш його з продажу і пройшло досить часу, може бути необхідно його полити."}</p>
      <button onClick={unlist}>Зняти з продажу</button>
    </div>
  );
}

// «Попап · подарувати другу»: нікнейм друга з перевіркою й незворотність.
function GiftSheet({ plant, onClose, onDone }) {
  const [nickname, setNickname] = useState("");
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const name = nickname.trim();
    if (name.length < 3) { setFound(null); return undefined; }
    const timer = setTimeout(() => {
      api.get(`/me/transfer/check?nickname=${encodeURIComponent(name)}`).then(setFound).catch(() => setFound(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [nickname]);

  const gift = async () => {
    setError(null);
    try {
      await api.post(`/me/plants/${plant.id}/gift`, { nickname: nickname.trim() });
      onDone();
    } catch (e) {
      const c = e.body?.error;
      setError(c === "last_plant" ? "Це твоє єдине кавенятко – спершу заведи ще одне"
        : c === "no_such_user" ? "Такого нікнейма немає" : c === "self_gift" ? "Це ти сам" : c ?? e.message);
    }
  };

  const ok = found?.found && !found.self;
  return (
    <div className="plant-sheet">
      <b className="plant-sheet-title">Подарувати {plant.name || "кавенятко"}</b>
      <p>Кавенятко переходить до іншого користувача разом з усіма подарованими комплектами. Скасувати подарунок неможливо.</p>
      <div className="field" style={{ gap: 7 }}>
        <div className="profile-label">Нікнейм друга</div>
        <label className="nick-field gift" data-tone={found && !ok ? "bad" : "ok"}>
          <input value={nickname} placeholder="нікнейм" spellCheck={false}
                 onChange={(e) => setNickname(e.target.value.replace(/\s/g, "").slice(0, 24))} />
          {ok && <span>знайдено</span>}
          {found && !found.found && <span>немає</span>}
          {found?.self && <span>це ти</span>}
        </label>
      </div>
      {error && <p style={{ color: "var(--accent-text)" }}>{error}</p>}
      <div className="confirm-btns r14">
        <button onClick={onClose}>Скасувати</button>
        <button disabled={!ok} onClick={gift}>Подарувати</button>
      </div>
    </div>
  );
}

// «Попап · скосити»: червона картка, що втрачається, і що лишиться.
function ScytheSheet({ plant, onClose, onDone }) {
  const [error, setError] = useState(null);
  const scythe = async () => {
    try { const r = await api.post(`/me/plants/${plant.id}/scythe`); onDone(r.plant_id); }
    catch (e) { setError(e.body?.error ?? e.message); }
  };
  return (
    <div className="plant-sheet danger">
      <div className="scythe-head">
        <span><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M7 7v12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8V7" /></svg></span>
        <b className="plant-sheet-title">Ну що ти за звір?</b>
      </div>
      <p style={{ lineHeight: 1.5 }}>Використовуй цю опцію лише якщо кавенятко зовсім негарне вдалося і хочеш виростити нове. Ресурси, витрачені на кавенятко, та подаровані комплекти буде втрачено.</p>
      <div className="scythe-keep"><img src="/assets/ui/sprout.png" alt="" /><b>Ти отримаєш лише: 1 саджанець</b></div>
      {error && <p style={{ color: "var(--accent-text)" }}>{error}</p>}
      <div className="scythe-btns">
        <button onClick={onClose}>Я передумав</button>
        <button onClick={scythe}>Скосити</button>
      </div>
    </div>
  );
}

export function Plant({ ctx }) {
  const assets = usePlantAssets();
  const [plants, setPlants] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [popup, setPopup] = useState(null);           // menu | gift | scythe | supply:<препарат>
  const touch = useRef(null);
  // Уся сцена на платформі (кущ, полиця, хмаринка, бульбашка, бочка)
  // зібрана в координатах макета — 390 px завширшки. На вужчому екрані
  // вона просто не влазила: платформа й репліка йшли за правий край, а кущ
  // зміщувався з центру (скарга власника 23.09.2026). Тому міряємо ширину
  // й масштабуємо композицію цілком: і спрайти, і підписи на них.
  //
  // Ref-функцією, а не useRef + useEffect: до завантаження кавенятка екран
  // повертає заглушку, і на момент ефекту вузла ще немає — спостерігач
  // чіплявся до null і множник назавжди лишався одиницею.
  const [pf, setPf] = useState(1);
  const watch = useRef(null);
  const layer = useCallback((el) => {
    watch.current?.disconnect();
    if (!el) return;
    // Спостерігача тримаємо в ref: без посилання на нього він переживав
    // перший вимір і зникав, тож поворот екрана вже нічого не міняв.
    watch.current = new ResizeObserver(([e]) => setPf(e.contentRect.width / 390));
    watch.current.observe(el);
  }, []);
  const [fx, setFx] = useState(null);                 // перехід стадії: попередня сцена й куди виросло
  const [pour, setPour] = useState(null);             // полив, що зараз грає
  const care = ctx.me?.care ?? {};
  useEffect(() => {
    if (!fx) return undefined;
    const t = setTimeout(() => setFx(null), 2200);
    return () => clearTimeout(t);
  }, [fx]);
  useEffect(() => {
    if (!pour) return undefined;
    const t = setTimeout(() => setPour(null), 1400);
    return () => clearTimeout(t);
  }, [pour]);

  // Кавенят може бути скільки завгодно (gamification_ui §MVP): стрілка
  // ліворуч і свайп листають, плюс праворуч — нове кавенятко.
  const reload = () => api.get("/me/plants").then((r) => {
    setPlants(r.plants);
    setIndex((i) => Math.min(i, Math.max(0, r.plants.length - 1)));
    return r.plants;
  });
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  useEffect(() => { setNote(null); setPopup(null); }, [index]);

  const plant = plants?.[index] ?? null;
  // Нове кавенятко (купив саджанець чи скосив старе) спершу отримує ім'я.
  useEffect(() => { if (plant && !plant.name) ctx.push("plantName", { plant }); }, [plant?.id]);

  if (error) return <div className="stage-pad"><div className="panel">Не вдалось завантажити: {error}</div></div>;
  if (!plants) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!plant) {
    return (
      <div className="stage-pad">
        <div className="panel" style={{ textAlign: "center" }}>
          <img src="/assets/ui/sprout.png" alt="" style={{ width: 48, margin: "8px auto 12px" }} />
          <div className="h2">Кавенятка ще немає</div>
          <p className="muted">Саджанець можна купити в Магазині – за монети або за зерна.</p>
          <button className="btn btn-primary" onClick={() => ctx.push("plantMarket")}>Обрати кавенятко</button>
        </div>
      </div>
    );
  }

  const growth = plant.growth ?? {};
  const onSale = plant.on_sale;
  const dressed = Boolean(plant.worn_set_id);
  const lock = onSale ? "Недоступно, поки кавенятко на продажу"
    : plant.mood !== "healthy" ? "Недоступно, поки кавенятко сумне" : null;
  const shelfEmpty = SHELF.every((s) => (care[s.key] ?? 0) <= 0);
  // Чого хоче: сумному — води; дорослому — одягу; тому, хто вже все зробив
  // сьогодні, — часу; інакше — препарат переходу.
  const waiting = Boolean(growth.ready_at) && new Date(growth.ready_at) > new Date();
  const need = plant.mood !== "healthy" ? "water"
    : growth.done || plant.growth_stage >= 10 ? "outfit"
    : waiting ? "time"
    : growth.need;
  // Під попапом хмаринки немає (кадри меню й попапів у макеті), репліка лишається.
  const want = !onSale && !shelfEmpty && !popup ? WANT[need] : null;
  const line = note
    ?? (waiting && plant.mood === "healthy" ? WAITING_LINE
      : plant.mood === "withered" ? WITHERED_LINE
      : plant.mood === "sad" ? SAD_LINE
      : shelfEmpty ? EMPTY_LINE
      : plant.growth_stage >= 10 && dressed ? DRESSED_LINE
      : WISH_LINE[plant.growth_stage] ?? "Хочу уваги");

  const openPlanting = () => {
    // Добовий гейт видно ще до відкриття екрана: інакше гравець розставить
    // двадцять листків і лише на «Посадити» дізнається, що зарано.
    if (growth.ready_at && new Date(growth.ready_at) > new Date()) { setNote("Одна стадія на добу – приходь завтра"); return; }
    ctx.push("planting", { plantId: plant.id, title: PLANTING_TITLE[growth.planting] ?? "Посадка", resume: Boolean(plant.appearance?.draft?.count) });
  };

  // Один тап по банці = одне застосування. Сервер вирішує, чи це рухає
  // стадію, чи кущ просто попив, чи час відкривати екран посадки.
  // bought — препарат щойно куплено в попапі, а care у цьому рендері ще старий.
  const apply = async (kind, bought = false) => {
    if (onSale) { setNote("Поки я на ринку, доглядати за мною не можна"); return; }
    const item = SHELF.find((s) => s.kind === kind);
    if (!bought && (care[item?.key] ?? 0) <= 0) { setPopup(`supply:${kind}`); return; }
    if (growth.planting && kind === growth.need) { openPlanting(); return; }
    setNote(null);
    const prev = instances;
    const from = plant.growth_stage;
    try {
      const r = await api.post(`/me/plants/${plant.id}/care`, { kind });
      if (kind === "water") setPour({ id: Date.now() });
      await ctx.refreshMe();
      await reload();
      if (r.grown) setFx({ id: Date.now(), prev, from, to: r.stage });
      if (r.grown) setNote(`Я підріс! Тепер стадія ${r.stage}`);
      else if (r.progress) setNote(`Дякую! Ще ${r.applications - r.progress} – і підросту`);
    } catch (e) {
      const code = e.body?.error;
      if (code === "needs_planting") openPlanting();
      else if (code === "wrong_care") setNote(WANT[e.body.need] ? `${WANT[e.body.need].title.replace("Хоче", "Хочу")}, а не це` : "Мені зараз потрібне інше");
      else if (code === "too_soon") setNote("Одна стадія на добу – приходь завтра");
      else if (code === "no_supply") setPopup(`supply:${kind}`);
      else if (code === "fully_grown") setNote("Я вже дорослий – одягни мене");
      else setNote(e.message);
    }
  };

  const wish = () => (need === "outfit" ? ctx.push("wardrobe", { plant }) : apply(need));
  const [cx, cy] = CLOUD_AT[Math.min(10, plant.growth_stage)] ?? CLOUD_AT[10];
  const instances = assets
    ? buildScene({ layout: assets.layout, appearance: plant.appearance, stage: plant.growth_stage, mood: plant.mood, worn: plant.worn })
      .filter((i) => i.group !== "platform")
    : [];

  const swipe = {
    onTouchStart: (e) => { touch.current = e.touches[0].clientX; },
    onTouchEnd: (e) => {
      const dx = e.changedTouches[0].clientX - (touch.current ?? 0);
      if (Math.abs(dx) > 60) setIndex((i) => Math.max(0, Math.min(plants.length - 1, i + (dx < 0 ? 1 : -1))));
    },
  };
  const close = () => setPopup(null);

  return (
    <div className="plant-screen" {...swipe}>
      <div className="plant-layer" ref={layer} style={{ "--pf": pf }}>
        <div className="plant-area">
          <img className="plant-platform" src="/assets/ui/platform.png" alt="" />
          {want && (
            <button className="wish" title={want.title} onClick={wish} style={{ left: cx, top: cy }}>
              <img src="/assets/ui/cloud_p1.png" alt="" />
              <img src="/assets/ui/cloud_p2.png" alt="" />
              <img src="/assets/ui/cloud_p3.png" alt="" />
              <span className="wish-icon">
                <img src={`/assets/ui/${want.src}.png`} alt={want.title}
                     style={{ left: want.at[0], top: want.at[1], width: want.at[2], height: want.at[3] }} />
              </span>
            </button>
          )}
          {!onSale && (
            <button className="plant-bubble" onClick={() => !lock && ctx.push("chat", { plant })}>
              <b>{plant.name || "Кавенятко"}</b>
              {line}
            </button>
          )}
          <div className="plant-scene">
            {assets && (fx ? (
              // «Перехід стадії росту»: кросфейд старої сцени в нову
              <>
                <div className="fx-fade-out" key={`o${fx.id}`}><Scene instances={fx.prev} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} /></div>
                <div className="fx-fade-in" key={`i${fx.id}`}><Scene instances={instances} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} idle /></div>
              </>
            ) : <Scene instances={instances} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} idle />)}
          </div>
          <Shelf care={care} onApply={apply} pour={pour} />
          {plant.growth_stage >= 10 && (
            <button className={`plant-barrel${fx?.to === 10 ? " fx-barrel-in" : ""}`} title="Бочка з зерном" onClick={() => setNote(BARREL_LINE)}>
              <img src="/assets/ui/barrel.png" alt="" />
            </button>
          )}
          {fx && <GrowthFx fx={fx} instances={instances} />}
        </div>

        <div className="plant-top">
          <span className="plant-slot">
            {index > 0 && (
              <button className="plant-round" title="Попереднє кавенятко" onClick={() => setIndex(index - 1)}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>
              </button>
            )}
          </span>
          <b className="plant-name">{plant.name || "Без імені"}</b>
          {index < plants.length - 1 ? (
            <button className="plant-round" title="Наступне кавенятко" onClick={() => setIndex(index + 1)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 5.5 16 12l-6.5 6.5" /></svg>
            </button>
          ) : (
            <button className="plant-add" title="Придбати кавенятко" onClick={() => ctx.push("plantMarket")}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 6v12M6 12h12" /></svg>
            </button>
          )}
        </div>

        {onSale && plant.listing && (
          <div className="plant-sale">
            <span>
              <img src={plant.listing.currency === "beans" ? "/assets/ui/bean.png" : "/assets/ui/coin_gold.png"} alt="" />
              На продажу · {new Intl.NumberFormat("uk-UA").format(plant.listing.price)}
            </span>
          </div>
        )}

        <div className="plant-actions">
          <button className="plant-act" title="Гардероб" disabled={Boolean(lock)} onClick={() => ctx.push("wardrobe", { plant })}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.2a2.1 2.1 0 1 0 2.1 2.1c0 1.5-2.1 1.7-2.1 3" /><path d="M12 9.6 3.6 15c-.9.6-.5 2 .6 2h15.6c1.1 0 1.5-1.4.6-2L12 9.6Z" /></svg>
            {lock && <Lock size={16} title={lock} />}
          </button>
          <button className="plant-chat" title="Чат з кавенятком" disabled={Boolean(lock)} onClick={() => ctx.push("chat", { plant })}>
            {plant.chat_unread > 0 && <i>{plant.chat_unread}</i>}
            <img src="/assets/ui/chat.png" alt="" />
            {lock && <Lock size={18} title={lock} />}
          </button>
          <button className="plant-act" title="Дії з кавенятком" data-open={popup === "menu" || onSale || undefined}
                  onClick={() => !onSale && setPopup(popup === "menu" ? null : "menu")}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5.5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="18.5" cy="12" r="1.9" /></svg>
          </button>
        </div>
      </div>

      {onSale && plant.listing && <SaleCard plant={plant} onDone={reload} />}
      {popup?.startsWith("supply:") && (
        <NoSupply kind={popup.slice(7)} ctx={ctx} onClose={close} onBought={() => { const kind = popup.slice(7); close(); apply(kind, true); }} />
      )}
      {popup && !popup.startsWith("supply:") && <div className="plant-dim" onClick={close} />}
      {popup === "menu" && (
        <ActionMenu onGift={() => setPopup("gift")}
                    onSell={() => { close(); ctx.push("sellPlant", { plant }); }}
                    onScythe={() => setPopup("scythe")} />
      )}
      {popup === "gift" && <GiftSheet plant={plant} onClose={close} onDone={() => { close(); reload(); }} />}
      {popup === "scythe" && (
        <ScytheSheet plant={plant} onClose={close}
                     onDone={async (id) => { close(); const list = await reload(); const i = list.findIndex((p) => p.id === id); if (i >= 0) setIndex(i); }} />
      )}
    </div>
  );
}

// Точка сцени (1000×1300, масштаб 0.26 від кута .plant-scene) у координатах
// .plant-area — там живуть іскорки й боби.
const inArea = (i) => ({ x: 66 + i.x * 0.26, y: 66 + i.y * 0.26 });
const isFruit = (i) => /^fruit_/.test(i.group ?? "");
// Центр бочки: кнопка 277×260, картинка з відступом 2×3 і розміром 68×70.
const BARREL_AT = { x: 277 + 2 + 34, y: 260 + 3 + 35 };

// Перехід стадії: великий сплеск конфеті над кроною; бутон → квітка → біб —
// маленькі іскорки на кожному плоді, що змінився; на стадії 10 сім бобів
// летять дугою в бочку, і вона з'являється з підскоком.
function GrowthFx({ fx, instances }) {
  const body = instances.find((i) => /^body_stage/.test(i.group ?? ""));
  const crown = body ? inArea(body) : { x: 196, y: 200 };
  const fruits = instances.filter(isFruit);
  const before = fx.prev.filter(isFruit);
  const changed = fruits.filter((f, n) => before[n]?.sprite !== f.sprite);
  return (
    <>
      <Sparks kind="stage" x={crown.x} y={crown.y} delay={350} duration={900} />
      {changed.map((f, n) => {
        const p = inArea(f);
        return <Sparks key={`f${n}`} kind="fruit" x={p.x} y={p.y} delay={450 + n * 40} />;
      })}
      {fx.to === 10 && (
        <>
          {fruits.slice(0, 7).map((f, n) => {
            const p = inArea(f);
            return (
              <img key={`b${n}`} className="fx-bean" src="/assets/ui/bean.png" alt=""
                   style={{ left: p.x - 9, top: p.y - 10, "--bx": `${BARREL_AT.x - p.x}px`, "--by": `${BARREL_AT.y - p.y}px`, animationDelay: `${n * 90}ms` }} />
            );
          })}
          <Sparks kind="barrel" x={BARREL_AT.x} y={BARREL_AT.y} delay={1150} />
        </>
      )}
    </>
  );
}
