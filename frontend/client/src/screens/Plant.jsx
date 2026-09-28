// Головний екран кавенятка — кадри «0 · Паросток» … «10 · Зів'яле»: небо,
// кущ, хмаринка з бажанням, репліка, поличка з препаратами, ім'я зверху й
// три дії знизу. Геометрія — з макета: сцена 1000×1300 у масштабі 0.26,
// поличка й хмаринка на тих самих місцях.
//
// Чого кущ хоче — каже сервер (plant.growth): таблиця переходів живе в
// economy.json, і другої її копії тут бути не має.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "../api.js";
import { usePlantAssets } from "../plant/assets.js";
import { buildScene } from "../plant/scene.js";
import { Scene } from "../plant/Scene.jsx";
import { NoSupply } from "../plant/NoSupply.jsx";
import { Sparks, Typewriter, calm, markCoinSource } from "../ui/fx.jsx";
import { isLandscape } from "../ui/landscape.js";
import {
  AFTER_CARE, BARREL, DRESSED, EMPTY, GROWN, MORE, ON_SALE, OOPS, SAD, TOO_SOON, WAITING, WITHERED,
  stageLines, wrongFirst, wrongMore,
} from "../plant/lines.js";
import { takeHandoff } from "../plant/handoff.js";
import { useConfirmWord } from "../ui/confirmWord.js";
import { rememberPlant, selectedIndex } from "../plant/selected.js";

// Хмаринка стоїть над верхівкою крони — у макеті її позиція своя на кожній стадії.
const CLOUD_AT = [[219, 199], [225, 183], [263, 106], [273, 83], [280, 68], [282, 55], [282, 45], [282, 37], [282, 30], [282, 23], [282, 17]];

// Ландшафт: відступ над композицією, її висота від верху хмаринки до низу
// видимої платформи (точки макета) і стеля масштабу.
const LAND_TOP = 8;
const LAND_HEIGHT = 441;
const LAND_MAX_PF = 1.6;

// Бажання в хмаринці: картинка, її місце всередині хмаринки й підпис.

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
// Репліки в хмарці — у plant/lines.js: там тексти власника з варіантами.

const Lock = ({ size, title }) => (
  <span className="plant-lock" title={title}>
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  </span>
);

// Полив (дошка «Анімації»): лійка нахиляється, з носика падають краплі, а
// число на кільці змінюється з легким підскоком — як і в решти препаратів.
// need — чого кавенятко хоче просто зараз. Решта банок приглушена й не
// натискається: витратити воду, коли її не просять, було можна, і сервер
// чесно відповідав «мені зараз потрібне інше» — але препарат при цьому вже
// списувався б, якби відповідь загубилась (зауваження власника 23.09.2026).
// ── Догляд над рослиною ──────────────────────────────────────────────
// Копія препарату злітає з полиці по дузі до верху рослини, робить своє й
// зникає; банка на полиці лишається, а число на кільці зменшується, як і
// раніше. Дизайн («дошка Анімації») описував лише нахил лійки на місці, а
// власник попросив, щоб поливали саму рослину й щоб решта препаратів теж
// мала свою дію (26.09.2026). Мова та сама, що в решти анімацій: лише
// transform і опасіті, без перемальовування.
//
// Координати — з реальних прямокутників: .plant-area масштабується цілком
// (--pf), тож екранні пікселі ділимо на її масштаб. Ціль — верх силуету
// рослини (об'єднання її спрайтів), тому на кожній стадії дія відбувається
// над кроною, а не в заданій наперед точці.
const CARE_FX_MS = 1500;
// Нахил — за годинниковою стрілкою: препарат висить лівіше центру крони, і
// отвором праворуч униз він сиплеться якраз на рослину. Лійка на полиці
// віддзеркалена й дивиться носиком ВІД рослини, тож у польоті вона
// розвертається (дзеркало знімається) — інакше вода лилася б повз кущ.
const CARE_FX = {
  water: { tilt: 42, parts: "drop", turn: "" },                    // на полиці віддзеркалена
  compost: { tilt: 48, parts: "grain", color: "#6B4A2B" },
  fertilizer: { tilt: 48, parts: "grain", color: "#EDE7D6" },
  insecticide: { tilt: 0, shake: true, parts: "mist", turn: "scaleX(-1)", nozzle: [0.45, -0.37] },   // носик ліворуч
};
// Де носик відносно центру препарату (частки ширини й висоти, вже після
// розвороту): лійка й мішки сиплють праворуч униз, розпилювач пирскає з
// головки праворуч угорі.
const SPOUT = [0.45, 0.25];

const OVER = 1.6;

function CareFx({ pour, areaRef }) {
  const host = useRef(null);
  useEffect(() => {
    const area = areaRef.current, box = host.current;
    if (!pour || !area || !box || calm()) return undefined;
    const spec = CARE_FX[pour.kind];
    const shelfImg = area.querySelector(`.shelf-item[data-kind="${pour.kind}"] img`);
    const plantImgs = [...area.querySelectorAll(".plant-scene img")];
    if (!spec || !shelfImg || !plantImgs.length) return undefined;

    const ar = area.getBoundingClientRect();
    const k = ar.width / area.offsetWidth || 1;
    const local = (r) => ({ x: (r.left - ar.left) / k, y: (r.top - ar.top) / k, w: r.width / k, h: r.height / k });
    const from = local(shelfImg.getBoundingClientRect());
    const plant = plantImgs.map((el) => el.getBoundingClientRect()).reduce((u, r) => ({
      left: Math.min(u.left, r.left), top: Math.min(u.top, r.top),
      right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const p = local({ left: plant.left, top: plant.top, width: plant.right - plant.left, height: plant.bottom - plant.top });
    const [nx, ny] = spec.nozzle ?? SPOUT;
    // Над кроною, трохи лівіше центру: носик лійки й отвір мішка дивляться
    // праворуч униз, тож частинки падають саме на рослину. Розпилювач —
    // нижче, біля голови зліва вгорі, головкою до крони: над кроною хмарка
    // йшла в повітря (власник, 28.09.2026). Рахуємо від тіла, а не від
    // верху силуету, — інакше на кущі без листя пляшка лягала на око. Тут
    // спершу ставимо носик, а пляшку — від нього.
    const bodyImg = area.querySelector('.plant-scene img[src*="/body_stage"]');
    const b = bodyImg ? local(bodyImg.getBoundingClientRect()) : p;
    const aim = spec.parts === "mist" ? { x: b.x + b.w * 0.12, y: b.y + b.h * 0.1 } : null;
    const to = aim
      ? { x: aim.x - from.w / 2 - nx * from.w * OVER, y: aim.y - from.h / 2 - ny * from.h * OVER }
      : { x: p.x + p.w / 2 - from.w * 0.9, y: Math.max(0, p.y - from.h * 1.2) };
    const dx = to.x - from.x, dy = to.y - from.y;
    const mirror = shelfImg.style.transform || "";
    // Розворот до рослини: віддзеркалене на полиці в польоті дивиться прямо.
    // turn — як препарат має дивитись над рослиною; немає — лишається як на полиці.
    const face = (after) => (after ? (spec.turn ?? mirror) : mirror);

    const flyer = shelfImg.cloneNode();
    Object.assign(flyer.style, { position: "absolute", left: `${from.x}px`, top: `${from.y}px`,
      width: `${from.w}px`, height: `${from.h}px`, transform: mirror, zIndex: 60,
      filter: "drop-shadow(0 6px 5px rgba(0,0,0,.35))" });
    box.appendChild(flyer);
    const t = (x, y, r = 0, sc = 1, turned = true) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sc}) ${face(turned)}`;
    // Над рослиною препарат більший, ніж на полиці (OVER): на полиці він
    // крихітний, і над кроною його ледь було видно (власник, 28.09.2026).
    const act = spec.shake
      ? [{ offset: 0.44, transform: t(dx, dy, -9, OVER) }, { offset: 0.52, transform: t(dx, dy, 9, OVER) },
         { offset: 0.6, transform: t(dx, dy, -9, OVER) }, { offset: 0.68, transform: t(dx, dy, 0, OVER) }]
      : [{ offset: 0.44, transform: t(dx, dy, spec.tilt, OVER) }, { offset: 0.7, transform: t(dx, dy, spec.tilt, OVER) }];
    const anims = [flyer.animate([
      { offset: 0, transform: t(0, 0, 0, 1, false), opacity: 1 },
      { offset: 0.18, transform: t(dx * 0.5, dy * 0.5 - 46, -6, 1.06, false) },      // дуга вгору
      { offset: 0.36, transform: t(dx, dy, 0, OVER) },
      ...act,
      { offset: 0.82, transform: t(dx, dy, 0, OVER), opacity: 1 },
      { offset: 1, transform: t(dx, dy - 10, 0, OVER * 0.8), opacity: 0 },
    ].map((kf) => ({ easing: "ease-in-out", ...kf })), { duration: CARE_FX_MS, easing: "linear", fill: "forwards" })];

    // Частинки — з носика/отвору на верх рослини. Масштаб іде від центру
    // препарату, тож і носик відсувається від центру разом з ним.
    const spout = { x: to.x + from.w / 2 + from.w * nx * OVER, y: to.y + from.h / 2 + from.h * ny * OVER };
    const fall = Math.max(40, p.y + Math.min(p.h, 120) * 0.5 - spout.y);
    const n = spec.parts === "mist" ? 7 : spec.parts === "grain" ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const el = document.createElement(spec.parts === "drop" ? "img" : "i");
      let kf, dur, delay;
      if (spec.parts === "drop") {
        el.src = "/assets/ui/droplet.png";
        Object.assign(el.style, { position: "absolute", width: "13px", height: "18px", left: `${spout.x + i * 6 - 6}px`, top: `${spout.y}px`, zIndex: 61 });
        kf = [{ transform: "translateY(0) scale(.7)", opacity: 0 }, { offset: 0.2, opacity: 1 }, { transform: `translateY(${fall}px) scale(1)`, opacity: 0 }];
        dur = 700; delay = CARE_FX_MS * 0.46 + i * 120;
      } else if (spec.parts === "grain") {
        const size = 3 + (i % 3);
        Object.assign(el.style, { position: "absolute", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
          background: spec.color, left: `${spout.x + (i % 3) * 5 - 5}px`, top: `${spout.y}px`, zIndex: 61,
          boxShadow: "0 1px 1px rgba(0,0,0,.35)" });
        const sway = (i % 2 ? 1 : -1) * (6 + (i % 4) * 5);
        kf = [{ transform: "translate(0,0)", opacity: 0 }, { offset: 0.15, opacity: 1 }, { transform: `translate(${sway}px, ${fall}px)`, opacity: 0 }];
        dur = 650; delay = CARE_FX_MS * 0.46 + i * 45;
      } else {
        const size = 18 + (i % 3) * 7;
        Object.assign(el.style, { position: "absolute", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(236,250,236,.75), rgba(236,250,236,0))",
          left: `${spout.x - size / 2}px`, top: `${spout.y - size / 2}px`, zIndex: 61 });
        // Конус від головки праворуч і трохи вниз — як пирскає розпилювач.
        const ang = -0.35 + (i / (n - 1)) * 1.1;
        const r = 30 + (i % 3) * 14;
        kf = [{ transform: "translate(0,0) scale(.3)", opacity: 0 }, { offset: 0.2, opacity: 0.9 },
              { transform: `translate(${Math.cos(ang) * r}px, ${Math.sin(ang) * r + 10}px) scale(1.5)`, opacity: 0 }];
        dur = 900; delay = CARE_FX_MS * 0.44 + i * 50;
      }
      box.appendChild(el);
      // Краплі й гранули падають із розгоном, а пирск вилітає різко й гасне.
      anims.push(el.animate(kf, { duration: dur, delay, easing: spec.parts === "mist" ? "ease-out" : "ease-in", fill: "both" }));
    }
    return () => { anims.forEach((a) => a.cancel()); box.replaceChildren(); };
  }, [pour?.id]);

  return <div ref={host} className="care-fx" aria-hidden="true" />;
}

function Shelf({ care, onApply, onWrong, need, canWater }) {
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
        const changed = (shown.current[s.key] ?? 0) !== n;
        // Застосувати можна лише потрібне зараз. Порожню банку потрібного
        // препарату лишаємо активною: тап по ній відкриває «не вистачає» —
        // це єдиний шлях докупити. Тап по непотрібному нічого не витрачає,
        // але кущ відповідає («Хочу води, а не оце»): мертва кнопка
        // виглядала зламаною (власник, 27.09.2026).
        // Воду можна дати й без прохання, коли минула доба від поливу
        // (canWater): полити можна, але не обов'язково (власник, 27.09.2026).
        const off = Boolean(need) && need !== s.kind && !(s.kind === "water" && canWater);
        return (
          <button key={s.key} className="shelf-item" data-kind={s.kind} data-off={off || undefined} aria-disabled={off || undefined}
                  onClick={() => (off ? onWrong(s.kind) : onApply(s.kind))}
                  style={{ left: s.box[0], top: s.box[1], width: s.box[2], height: s.box[3] }}>
            {s.crop ? <span className="shelf-crop">{img}</span>
              : img}
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
// only — кавенятко в гравця єдине: віддати чи продати його не можна (сервер
// відповідає last_plant). Кажемо це в самому рядку, а не помилкою після
// натискання (власник, 26.09.2026).
const ONLY_ONE = "Потрібно мати хоч одне кавенятко";

function ActionMenu({ onGift, onSell, onScythe, only }) {
  const row = (icon, title, sub, onClick, extra = {}) => (
    <button className="menu-row" onClick={onClick} disabled={extra.off} data-danger={extra.danger || undefined}>
      <span className="menu-ico">{icon}</span>
      <span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
  return (
    <div className="plant-menu">
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8.5V21" /><path d="M4.5 12.5h15V21h-15z" /><path d="M4.5 8.5h15v4h-15z" /><path d="M12 8.5S9.2 8.5 8 7.3a2.4 2.4 0 1 1 4-2.6" /><path d="M12 8.5s2.8 0 4-1.2a2.4 2.4 0 1 0-4-2.6" /></svg>,
        "Подарувати другу", only ? ONLY_ONE : "Переходить іншому користувачу з усім подарованим одягом", onGift, { off: only })}
      {row(<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.4v9.2" /><path d="M14.6 9.6c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.9.8-2.9 2 0 2.8 5.9 1.6 5.9 4.2 0 1.2-1.3 2-3 2-1.3 0-2.4-.5-3-1.3" /></svg>,
        "Продати на ринку", only ? ONLY_ONE : "Ціна в монетах або бобах, мінімум 10", onSell, { off: only })}
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
    catch (e) { setError(errText(e)); }
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
        : c === "no_such_user" ? "Такого нікнейма не знайдено" : c === "self_gift" ? "Це ти сам" : c ?? e.message);
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
          {found && !found.found && <span>не знайдено</span>}
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
// Слово-підтвердження, як при видаленні акаунта (DeleteAccount.jsx): косіння
// безповоротне, і дві кнопки поруч — це один помилковий тап (власник, 26.09.2026).
const SCYTHE_WORD = "скосити";

function ScytheSheet({ plant, onClose, onDone }) {
  const [error, setError] = useState(null);
  const [word, setWord] = useState("");
  const check = useConfirmWord(word, SCYTHE_WORD);
  const scythe = async () => {
    if (!check.ok()) return;
    try { const r = await api.post(`/me/plants/${plant.id}/scythe`, { confirm: word.trim().toLowerCase() }); onDone(r.plant_id); }
    catch (e) { setError(e.body?.error === "confirm_required" ? `Напиши «${SCYTHE_WORD}», щоб підтвердити` : errText(e)); }
  };
  return (
    <div className="plant-sheet danger">
      <div className="scythe-head">
        <span><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M7 7v12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8V7" /></svg></span>
        <b className="plant-sheet-title">Ну що ти за звір?</b>
      </div>
      <p style={{ lineHeight: 1.5 }}>Використовуй цю опцію лише якщо кавенятко зовсім негарне вдалося і хочеш виростити нове. Ресурси, витрачені на кавенятко, та подаровані комплекти буде втрачено.</p>
      <div className="scythe-keep"><img src="/assets/ui/sprout.png" alt="" /><b>Ти отримаєш лише: 1 саджанець</b></div>
      <input ref={check.ref} className="confirm-input" value={word} placeholder={`напиши «${SCYTHE_WORD}»`} data-invalid={check.invalid || undefined}
             autoComplete="off" spellCheck={false} onChange={(e) => { setWord(e.target.value); check.reset(); }} />
      {check.invalid && <p className="confirm-hint">Напиши «{SCYTHE_WORD}», щоб підтвердити</p>}
      {error && <p style={{ color: "var(--accent-text)" }}>{error}</p>}
      <div className="scythe-btns">
        <button onClick={onClose}>Я передумав</button>
        <button onClick={scythe}>Скосити</button>
      </div>
    </div>
  );
}

// Хмарка з реплікою. Варіант обирається випадково, коли ситуація
// з'являється, і тримається, поки вона та сама, — а не тасується на кожен
// рендер. Іншу репліку дає повтор того, що її викликало (ще раз полити,
// ще раз тапнути бочку чи непотрібну банку): та сама ситуація з новою
// міткою — і вже гарантовано інший варіант. Тап по самій хмарці, як і
// раніше, відкриває чат (власник, 27.09.2026).
const randomIndex = (n) => Math.floor(Math.random() * n);
const otherIndex = (n, cur) => (n < 2 ? 0 : (cur + 1 + randomIndex(n - 1)) % n);

// onShow — хмаринка показала нову репліку (Plant кличе це лише для стану,
// а не для відповіді на тап): вона дублюється в чат, коли людина давно не
// писала (routes/chat.js, /chat/echo).
function Bubble({ name, lines, stamp, onOpen, onShow }) {
  const [pick, setPick] = useState(() => ({ lines, stamp, i: randomIndex(lines.length) }));
  let i = pick.i;
  if (pick.lines !== lines || pick.stamp !== stamp) {
    i = pick.lines === lines ? otherIndex(lines.length, pick.i) : randomIndex(lines.length);
    setPick({ lines, stamp, i });
  }
  const text = lines[i] ?? lines[0];
  useEffect(() => { if (onShow && text) onShow(text); }, [text, Boolean(onShow)]);
  return (
    <button className="plant-bubble" onClick={onOpen}>
      <b>{name}</b>
      <Typewriter text={text} />
    </button>
  );
}

export function Plant({ ctx }) {
  const assets = usePlantAssets();
  const [plants, setPlants] = useState(() => api.peek("/me/plants")?.plants ?? null);
  // Обране кавенятко переживає зміну екранів і перезавантаження (plant/selected.js).
  const [index, setIndex] = useState(() => selectedIndex(api.peek("/me/plants")?.plants));
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);             // щойно сказане: { lines, at }
  // Мітка часу — щоб той самий масив двічі поспіль (полив, ще полив) дав
  // нову репліку, а не лишив стару.
  const say = (lines) => setNote({ lines, at: Date.now() });
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
  //
  // У ландшафті межа — висота: за шириною композиція вийшла б утричі
  // вищою за екран. Тоді вміщаємо її від верху хмаринки й полиці (17 точок
  // макета від верху) до низу видимої платформи (60 точок під композицією,
  // bottom у theme.css, розділ «ландшафт») — 441 точка. Ім'я вгорі лягає
  // на небо над кроною: хмаринка й полиця по боках, а крона починається
  // нижче. Дії в ландшафті збоку, тож резерву під них знизу немає. Стеля
  // 1.6 — щоб на великому моніторі кущ не ставав мультяшно велетенським.
  const [pf, setPf] = useState(1);
  const watch = useRef(null);
  const layer = useCallback((el) => {
    watch.current?.disconnect();
    if (!el) return;
    // Спостерігача тримаємо в ref: без посилання на нього він переживав
    // перший вимір і зникав, тож поворот екрана вже нічого не міняв.
    watch.current = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setPf(isLandscape() ? Math.min(width / 390, (height - LAND_TOP) / LAND_HEIGHT, LAND_MAX_PF) : width / 390);
    });
    watch.current.observe(el);
  }, []);
  const [fx, setFx] = useState(null);                 // перехід стадії: попередня сцена й куди виросло
  const [pour, setPour] = useState(null);             // догляд, що зараз грає: { id, kind }
  const area = useRef(null);
  const care = ctx.me?.care ?? {};
  useEffect(() => {
    if (!fx) return undefined;
    const t = setTimeout(() => setFx(null), 2200);
    return () => clearTimeout(t);
  }, [fx]);
  useEffect(() => {
    if (!pour) return undefined;
    const t = setTimeout(() => setPour(null), CARE_FX_MS + 200);
    return () => clearTimeout(t);
  }, [pour]);

  // Препарат для посадки (компост, добриво, інсектицид на переходах 1→7)
  // спершу грає свою дію над кущем, а екран посадки відкривається, коли
  // вона скінчилась: раніше до цих анімацій справа не доходила зовсім
  // (власник, 27.09.2026). Будь-який перехід за цей час скасовує
  // відкриття: інша вкладка чи екран розмонтовують кавенятко, шторка
  // (Профіль) змінює ctx.depth, меню дій чи інше кавенятко — popup/index.
  const plantingSoon = useRef(null);
  const cancelPlanting = () => { clearTimeout(plantingSoon.current); plantingSoon.current = null; };
  useEffect(() => cancelPlanting, []);
  useEffect(cancelPlanting, [ctx.depth, index, popup]);

  // Повернення з посадки: кущ, яким був до неї, препарат над ним — і лише
  // тоді новий, звичним переходом стадії. Записку лишає Planting.jsx.
  const [replay, setReplay] = useState(null);
  const [oldScene, setOldScene] = useState(null);
  // Подарований комплект (Wardrobe.jsx): тут показуємо саме те
  // кавенятко, а боби з його бочки летять у баланс у шапці.
  const [gift, setGift] = useState(null);
  const [giftFx, setGiftFx] = useState(null);
  const barrel = useRef(null);
  useEffect(() => {
    const h = takeHandoff();
    if (h?.kind === "gift") setGift(h);
    else if (h) setReplay(h);
  }, []);

  // Кавенят може бути скільки завгодно (gamification_ui §MVP): стрілка
  // ліворуч і свайп листають, плюс праворуч — нове кавенятко.
  const reload = () => api.get("/me/plants").then((r) => {
    setPlants(r.plants);
    setIndex(() => selectedIndex(r.plants));
    return r.plants;
  });
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  useEffect(() => { setNote(null); setPopup(null); }, [index]);
  useEffect(() => { if (plants?.[index]) rememberPlant(plants[index].id); }, [plants, index]);

  // Спершу гортаємо до подарованого кавенятка, а коли воно на екрані й
  // бочка намальована — позначаємо бочку джерелом і оновлюємо баланс:
  // шапка побачить приріст зерен і пустить їх звідти (Hud.jsx).
  useEffect(() => {
    if (!gift || !plants) return undefined;
    const at = plants.findIndex((p) => p.id === gift.plantId);
    if (at >= 0 && at !== index) { setIndex(at); return undefined; }
    const t = setTimeout(() => {
      markCoinSource(barrel.current);
      setGiftFx(Date.now());
      setGift(null);
      ctx.refreshMe();
    }, 450);
    return () => clearTimeout(t);
  }, [gift, plants, index]);
  useEffect(() => {
    if (!giftFx) return undefined;
    const t = setTimeout(() => setGiftFx(null), 1800);
    return () => clearTimeout(t);
  }, [giftFx]);

  const plant = plants?.[index] ?? null;

  useEffect(() => {
    if (!replay || !assets || !plant) return undefined;
    if (plant.id !== replay.plantId) { setReplay(null); return undefined; }
    const prev = buildScene({ layout: assets.layout, appearance: replay.appearance, stage: replay.from, mood: plant.mood, worn: plant.worn })
      .filter((i) => i.group !== "platform");
    setOldScene(prev);
    setPour({ id: Date.now(), kind: replay.kind });
    const t = setTimeout(() => {
      setOldScene(null);
      setFx({ id: Date.now(), prev, from: replay.from, to: replay.to });
      say(AFTER_CARE[replay.kind] ?? MORE);
      setReplay(null);
    }, calm() ? 0 : CARE_FX_MS);
    return () => clearTimeout(t);
  }, [replay, assets, plant?.id]);
  // Нове кавенятко (купив саджанець чи скосив старе) спершу отримує ім'я.
  //
  // «Уже пропонували» памʼятає sessionStorage, а не ref: коли попап
  // закривають, стек порожніє, .stage міняє key — і екран кавенятка
  // монтується наново разом з усіма своїми ref-ами. Без цієї позначки
  // попап відкривався б назад тієї ж миті, і «Пізніше» не працювало б
  // (23.09.2026).
  useEffect(() => {
    if (!plant || plant.name) return;
    const key = `extrovert.named.${plant.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* приватний режим */ }
    ctx.push("plantName", { plant });
  }, [plant?.id]);

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
  // Поки грає перехід після посадки, хмаринка не просить наступного.
  const want = !onSale && !shelfEmpty && !popup && !oldScene ? WANT[need] : null;
  // Полити можна раз на добу, навіть якщо кущ не просить (сервер тримає ту
  // саму межу: water_too_soon).
  const canWater = !onSale && (!plant.last_watered_at || Date.now() - new Date(plant.last_watered_at).getTime() >= 24 * 60 * 60 * 1000);
  const idle = waiting && plant.mood === "healthy" ? WAITING
    : plant.mood === "withered" ? WITHERED
    : plant.mood === "sad" ? SAD
    : shelfEmpty ? EMPTY
    : plant.growth_stage >= 10 && dressed ? DRESSED
    : stageLines(plant.growth_stage, growth.need);
  const lines = note?.lines ?? idle;
  // Нова репліка стану — і в чат, якщо людина давно не писала (сервер
  // вирішує сам: давність, не більше трьох реплік кавенятка поспіль, без
  // повторів). Продублювали — оновлюємо лічильник непрочитаних на кнопці.
  const echoToChat = (text) => {
    api.post(`/me/plants/${plant.id}/chat/echo`, { text })
      .then((r) => { if (r?.echoed) reload().catch(() => {}); })
      .catch(() => {});
  };

  // Не той препарат. Перший тап називає, чого кущ хоче; повтори — репліки
  // з його поточного стану: вдягнений каже «в чому сенс бути кущем без
  // нового комплекту», сумний просить пити. Раніше повтори крутили «ти
  // щось не то клацаєш» (власник, 27.09.2026).
  const wrong = (want) => {
    const first = wrongFirst(want);
    const more = wrongMore(first, idle);
    say(note?.lines === first || note?.lines === more ? more : first);
  };

  const openPlanting = () => {
    // Добовий гейт видно ще до відкриття екрана: інакше гравець розставить
    // двадцять листків і лише на «Посадити» дізнається, що зарано.
    if (growth.ready_at && new Date(growth.ready_at) > new Date()) { say(TOO_SOON); return; }
    ctx.push("planting", { plantId: plant.id, title: PLANTING_TITLE[growth.planting] ?? "Посадка", resume: Boolean(plant.draft?.count) });   // лише чернетка поточної посадки (liveDraft)
  };

  // Посадка після дії препарату над кущем (див. plantingSoon вище). Гейт
  // перевіряємо до анімації: «приходь завтра» не варте сипання компосту.
  const plantAfterCare = (kind) => {
    if (plantingSoon.current) return;   // уже сиплеться — другий тап нічого не додає
    if (growth.ready_at && new Date(growth.ready_at) > new Date()) { say(TOO_SOON); return; }
    if (calm()) { openPlanting(); return; }
    setNote(null);
    setPour({ id: Date.now(), kind });
    plantingSoon.current = setTimeout(() => { plantingSoon.current = null; openPlanting(); }, CARE_FX_MS);
  };

  // Один тап по банці = одне застосування. Сервер вирішує, чи це рухає
  // стадію, чи кущ просто попив, чи час відкривати екран посадки.
  // bought — препарат щойно куплено в попапі, а care у цьому рендері ще старий.
  const apply = async (kind, bought = false) => {
    if (onSale) { say(ON_SALE); return; }
    const item = SHELF.find((s) => s.kind === kind);
    if (!bought && (care[item?.key] ?? 0) <= 0) { setPopup(`supply:${kind}`); return; }
    if (growth.planting && kind === growth.need) { plantAfterCare(kind); return; }
    setNote(null);
    const prev = instances;
    const from = plant.growth_stage;
    try {
      const r = await api.post(`/me/plants/${plant.id}/care`, { kind });
      setPour({ id: Date.now(), kind });
      await ctx.refreshMe();
      await reload();
      if (r.grown) setFx({ id: Date.now(), prev, from, to: r.stage });
      // Кущ дякує своїм словом на кожен препарат — і коли підріс, і коли
      // просто попив; «ще трохи» — коли переходу треба кілька доглядів.
      say(!r.grown && r.progress ? MORE : AFTER_CARE[kind] ?? MORE);
    } catch (e) {
      const code = e.body?.error;
      if (code === "needs_planting") openPlanting();
      else if (code === "wrong_care") wrong(e.body.need);
      else if (code === "water_too_soon") wrong(need);
      else if (code === "too_soon") say(TOO_SOON);
      else if (code === "no_supply") setPopup(`supply:${kind}`);
      else if (code === "fully_grown") say(GROWN);
      else if (!e.offline) say(OOPS);   // про обрив звʼязку вже каже тост
    }
  };

  // Хмаринка з пісочним годинником — не прохання препарату, а «приходь
  // завтра»: препарату з таким ключем немає, apply() йшов у попап
  // supply:time, а той падав на невідомому виді — і замість попапа був
  // чорний екран (скарга власника 23.09.2026). Тепер кавенятко просто
  // каже це словами.
  const wish = () => {
    if (need === "outfit") return ctx.push("wardrobe", { plant });
    if (need === "time") return say(WAITING);
    return apply(need);
  };
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
        <div className="plant-area" ref={area}>
          <img className="plant-platform" src="/assets/ui/platform.png" alt="" />
          {want && (
            <button className="wish" data-tap="off" title={want.title} onClick={wish} style={{ left: cx, top: cy }}>
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
            <Bubble name={plant.name || "Кавенятко"} lines={lines} stamp={note?.at ?? 0}
                    onOpen={() => !lock && ctx.push("chat", { plant })}
                    onShow={note ? undefined : echoToChat} />
          )}
          <div className="plant-scene">
            {assets && (fx ? (
              // «Перехід стадії росту»: кросфейд старої сцени в нову
              <>
                <div className="fx-fade-out" key={`o${fx.id}`}><Scene instances={fx.prev} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} /></div>
                <div className="fx-fade-in" key={`i${fx.id}`}><Scene instances={instances} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} idle /></div>
              </>
            ) : <Scene key={plant.id} reveal instances={oldScene ?? instances} layout={assets.layout} mood={plant.mood} camera={{ k: 0.26, tx: 0, ty: 0 }} idle />)}
          </div>
          <Shelf care={care} onApply={apply} need={need} canWater={canWater}
                 onWrong={() => (onSale ? say(ON_SALE) : need === "time" ? say(TOO_SOON) : wrong(need))} />
          <CareFx pour={pour} areaRef={area} />
          {plant.growth_stage >= 10 && (
            <button ref={barrel} className={`plant-barrel${fx?.to === 10 ? " fx-barrel-in" : ""}`} title="Бочка з зерном" onClick={() => say(BARREL)}>
              <img src="/assets/ui/barrel.png" alt="" className={giftFx ? "fx-pulse" : undefined} />
            </button>
          )}
          {fx && <GrowthFx fx={fx} instances={instances} />}
          {giftFx && <Sparks key={giftFx} kind="barrel" x={BARREL_AT.x} y={BARREL_AT.y} />}
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
              На продажу за {new Intl.NumberFormat("uk-UA").format(plant.listing.price)}
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
        <ActionMenu only={plants.length <= 1} onGift={() => setPopup("gift")}
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
