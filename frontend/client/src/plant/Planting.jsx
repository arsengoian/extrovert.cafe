// Екрани посадки: листя (фон і чоло), гілки, бутони — кадри «… · як це
// працює», «… · вибір скіна», «… · трансформація» і «Незавершена посадка».
// Один компонент на всі чотири типи — різниця тільки в конфізі з
// placement.js і в підписах: сцена на все небо, лічильник угорі, плаваюча
// панель знизу, а камера вміщає зону й кущ у простір над панеллю.
//
// Поки не натиснуто «Посадити», нічого не списано: чернетка їде на сервер у
// appearance.draft (docs/bush_planting_ui.md §1).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errText } from "../api.js";
import { plural } from "../ui/plural.js";
import { Scene } from "./Scene.jsx";
import { usePlantAssets } from "./assets.js";
import { FRUIT_FOREGROUND_Z, W0, fitCamera, growthFactor, smoothD } from "./geometry.js";
import { ANCHOR, baseInstances, playerInstances } from "./scene.js";
import { budTargets, config, createAt, groupFor, moveTo, resolve, resolveDraft, rootOf, spriteFor } from "./placement.js";
import { CounterChip, Dial, RangeRow, SkinGrid, Steps, ZOrderRow } from "./controls.jsx";
import { Sparks } from "../ui/fx.jsx";
import { useLandscape } from "../ui/landscape.js";
import { selectedPlantId } from "./selected.js";
import { leaveHandoff } from "./handoff.js";

// Іскорки посадки — одна механіка, різний масштаб часток (дошка «Анімації»).
const POP_SPARKS = { leafBg: "leaf", leafFg: "leaf", branch: "branch", bud: "bud" };

// Препарат переходу: картинка з пропорціями файлу, назви й одиниця.
const CARE = {
  compost: { src: "/assets/ui/compost.png", ratio: 157 / 230, of: "компосту", stock: "Компост у запасі", key: "compost_kg", unit: "кг" },
  fertilizer: { src: "/assets/ui/mineral.png", ratio: 114 / 229, of: "добрива", stock: "Добриво у запасі", key: "fertilizer_kg", unit: "кг" },
  insecticide: { src: "/assets/ui/insecticide.png", ratio: 103 / 230, of: "інсектициду", stock: "Інсектицид у запасі", key: "insecticide_bottles", unit: "шт" },
};
const CareIcon = ({ need, h, style }) => (
  <img src={CARE[need].src} alt={CARE[need].of} style={{ width: Math.round(h * CARE[need].ratio), height: h, ...style }} />
);

const PHASE = {
  leafBg: {
    label: "Листки", introTitle: "Одягни кавенятко в листя",
    intro: ["Доторкнися до підсвіченої зони, щоб посадити новий листок з обраним скіном.",
            "Тягни його, крути й міняй розмір, а щоб відредагувати інший – доторкнися до нього.",
            "Треба від 20 до 40 листків. Поки ти не натиснеш «Посадити», компост не спишеться."],
  },
  leafFg: {
    label: "Листки", introTitle: "Тепер листя спереду",
    intro: ["Ці листки малюються поверх кавенятка й закривають частину тіла.",
            "Кут тут вільний, 0–359° – крути як завгодно.",
            "Крок необов'язковий: можна поставити до 5 листків або пропустити."],
  },
  branch: {
    label: "Гілки", introTitle: "Додай кавенятку гілки",
    intro: ["Гілка кріпиться коренем до дуги – тягни вздовж неї, точка підбереться сама.",
            "Доторкнися до порожнього місця, щоб створити нову гілку, або до існуючої гілки – щоб обрати.",
            "Потрібно посадити від 2 до 4 гілок."],
  },
  bud: {
    label: "Бутони", introTitle: "Час для бутонів",
    // Третій рядок — які саме бутони садимо зараз (budsNow): він залежить
    // від уже посадженого, тож збирається на льоту.
    intro: ["Бутон чіпляється до тіла або будь-якої посадженої гілки.",
            "Просто тягни його – він сам розташується, де потрібно. На гілці – з того боку, де відпустиш."],
  },
};

// Бутони йдуть 1, 2, 2, 2 за стадію (routes/planting.js), тож «які саме»
// видно з того, скільки вже посаджено.
const ORDINAL = ["перший", "другий", "третій", "четвертий", "п'ятий", "шостий", "сьомий"];
const budsNow = (planted, n) => {
  const which = ORDINAL.slice(planted, planted + n);
  return which.length > 1
    ? `Зараз потрібно посадити ${which.join(" та ")} бутони із семи.`
    : `Зараз потрібно посадити ${which[0] ?? "останній"} бутон із семи.`;
};

// Камера посадки. Раніше кадр вміщав і зону, і все розставлене, і
// перераховувався на кожен рух пальця: повів листок до краю — сцена
// зменшилась, повів далі — ще раз. Власник: «дуже вже смикає» (26.09.2026).
// Тепер кадр рахується з того, що за крок не змінюється (зона, кущ, посаджене
// на минулих стадіях); стеження за чернеткою лишилось і вмикається тут.
// Крайні листки при цьому можуть трохи вилазити за край — це прийнятно.
const CAMERA_FOLLOWS_DRAFT = false;

// Кадр прив'язаний до верху й завжди лишає знизу місце під найвищу робочу
// панель — редагування з обраним елементом. Раніше нижня межа кадру йшла за
// висотою поточної панелі, тож обрав листок — кущ стрибнув угору, зняв вибір
// — униз (власник, 26.09.2026). Число — від низу екрана до верху кошика над
// тією панеллю (260 px, заміряно в браузері), щоб і він не ліз на кущ.
const CAMERA_TOP = 40;           // під лічильником
const CAMERA_PANEL_ROOM = 262;

// У ландшафті панель стоїть праворуч (theme.css, .pl-sheet), і кадр
// займає все ліворуч від неї на повну висоту: знизу тоді резерв не
// потрібен, а висота — саме те, чого в ландшафті бракує. Ширина панелі
// разом із відступом від краю — та сама, що в CSS.
const CAMERA_PANEL_SIDE = 340;

// Біле коло навколо обраного — воно ж і зона дотику (частка ширини спрайта).
const ringOf = (phase) => (phase === "bud" ? 0.42 : 0.44);

// Іконка лічильника й її розмір — як у кадрах.
const ICON = {
  leafBg: ["/assets/sprites/leaves_batch_normal/leaf_skin1_normal.png", 22],
  leafFg: ["/assets/sprites/leaves_batch_normal/leaf_skin1_normal.png", 22],
  branch: ["/assets/sprites/branch_skins_custom/branch_custom_skin1.png", 24],
  bud: ["/assets/sprites/fruit_bud_greenbean/fruit_bud.png", 20],
};

// Що садимо — у родовому для «Ти вже почав садити …» і в підтвердженні.
const WHAT = {
  leaves: { forever: "Листя залишиться таким назавжди", verb: "листя", count: (n) => plural(n, "листок", "листки", "листків"), move: "змінити скіни або переставити листя" },
  branches: { forever: "Гілки залишаться такими назавжди", verb: "гілки", count: (n) => plural(n, "гілку", "гілки", "гілок"), move: "змінити скіни або переставити гілки" },
  buds: { forever: "Бутони залишаться такими назавжди", verb: "бутони", count: (n) => plural(n, "бутон", "бутони", "бутонів"), move: "переставити бутони" },
};

// Бутонів за життя — сім, по 1–2 на стадію: лічильник показує всі разом.
const BUDS_TOTAL = 7;

// Який тип садимо зараз і в якому полі це поїде на сервер.
const FIELD = { leafBg: "bg", leafFg: "fg", branch: "branches", bud: "buds" };
const EMPTY = { bg: [], fg: [], branches: [], buds: [] };

// Кроки кожної посадки й поле, яке кожен із них наповнює.
const PHASES = { leaves: ["leafBg", "leafFg"], branches: ["branch"], buds: ["bud"] };
const PHASE_OF_FIELD = Object.fromEntries(Object.entries(FIELD).map(([p, f]) => [f, p]));

// «Кількість не збігається» сама по собі нічого не каже: людина не знає, що
// саме полічено не так. Сервер віддає поле й межі — показуємо їх.
const COUNT_OF = { bg: "Фонових листків", fg: "Листків на чолі", branches: "Гілок", buds: "Бутонів" };
const badCount = ({ key, min, max, got }) =>
  `${COUNT_OF[key] ?? "Елементів"} треба ${min === max ? min : `від ${min} до ${max}`}, а стоїть ${got}.`;

const ERRORS = {
  no_supply: "Не вистачає препарату",
  too_soon: "Одна стадія на добу – посадка відкриється завтра",
  nothing_to_plant: "Зараз садити нічого",
  on_sale: "Кавенятко виставлене на продаж",
};

const Trash = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round">
    <path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M7 7v12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8V7" />
  </svg>
);

export function Planting({ ctx, plantId, title, resume }) {
  const assets = usePlantAssets();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(null);           // leafBg | leafFg | branch | bud
  const [items, setItems] = useState(EMPTY);
  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState("intro");        // intro | edit | skins | confirm | resume
  // Масштаб кадру: звичайний — найкрупніший (зона цього кроку й кущ);
  // віддалений — усе, куди можуть дістати листя й гілки на будь-якому
  // кроці, щоб бачити кущ цілком (власник, 01.10.2026).
  const [zoomOut, setZoomOut] = useState(false);
  const [skipFg, setSkipFg] = useState(false);        // «пропустити» листя на чолі
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);
  const [box, setBox] = useState({ w: 390, h: 602 });
  const wide = useLandscape();
  const [host, setHost] = useState(null);
  useEffect(() => setHost(document.querySelector(".app")), []);
  // Щойно посаджений елемент: виростає з bounce, навколо — іскорки.
  const [pop, setPop] = useState(null);
  useEffect(() => {
    if (!pop) return undefined;
    const t = setTimeout(() => setPop(null), 900);
    return () => clearTimeout(t);
  }, [pop]);

  const id = plantId ?? selectedPlantId() ?? ctx.me?.plants?.[0]?.id;

  // Перший крок поточної стадії. Потрібен двом місцям: старту й «почати
  // заново», тож рахується один раз і з одного джерела.
  const phaseOf = (planting) => (planting === "leaves" ? "leafBg" : planting === "branches" ? "branch" : "bud");
  const firstPhase = phaseOf(data?.state?.planting);

  useEffect(() => {
    api.get(`/me/plants/${id}/planting`)
      .then((d) => {
        setData(d);
        const first = phaseOf(d.state.planting);
        const draft = d.draft;   // сервер віддає лише чернетку цієї посадки (liveDraft)
        // Крок із чернетки — лише якщо він належить цій посадці. А на «чоло»
        // без повного фонового листя не пускаємо: посадити там його нема
        // де, а сервер вимагатиме його кількість — це й був глухий кут, з
        // якого кущ виходив лише скошуванням (власник, 26.09.2026).
        let next = PHASES[d.state.planting]?.includes(draft?.phase) ? draft.phase : first;
        if (next === "leafFg" && (draft?.items?.bg?.length ?? 0) < (d.state.limits?.bg?.[0] ?? 0)) next = "leafBg";
        setPhase(next);
        // З чернетки беремо лише поля цієї посадки; якщо в них порожньо,
        // продовжувати нічого — починаємо з «як це працює».
        const own = (PHASES[d.state.planting] ?? []).map((p) => FIELD[p]);
        const kept = Object.fromEntries(own.map((key) => [key, draft?.items?.[key] ?? []]));
        if (own.some((key) => kept[key].length)) {
          setItems({ ...EMPTY, ...kept });
          setSheet(resume ? "resume" : "edit");
        }
      })
      .catch((e) => setError(errText(e)));
  }, [id]);

  // Кадр підганяється під реальний розмір сцени: у браузері на ПК і на
  // телефоні це різні числа. Висота панелі сюди вже не входить — див.
  // CAMERA_PANEL_ROOM.
  useLayoutEffect(() => {
    const measure = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setBox({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [data, assets, phase]);   // .pl з'являється лише разом з асетами й кроком

  const cfg = useMemo(() => (assets && phase ? config(assets, phase) : null), [assets, phase]);
  const stage = data?.state?.to ?? 2;
  const f = growthFactor(stage);
  // Зони задані в зрілій сцені, а кущ на екрані ще малий: і зони, і корені
  // живуть у зрілих координатах, а на екран ідуть через те саме зростання.
  const toStage = useCallback((p) => ({ x: ANCHOR.x + (p.x - ANCHOR.x) * f, y: ANCHOR.y + (p.y - ANCHOR.y) * f }), [f]);
  const toMature = useCallback((p) => ({ x: ANCHOR.x + (p.x - ANCHOR.x) / f, y: ANCHOR.y + (p.y - ANCHOR.y) / f }), [f]);

  const targets = useMemo(() => {
    if (!assets || phase !== "bud") return null;
    return budTargets(assets, data?.appearance?.branches ?? []);
  }, [assets, phase, data]);

  const list = items[FIELD[phase] ?? "bg"] ?? [];
  const limits = data?.state?.limits ?? {};
  const [min, max] = limits[FIELD[phase]] ?? [0, 0];

  const resolved = useMemo(() => {
    if (!cfg || !assets) return [];
    return list.map((it) => resolve(it, { assets, cfg, targets }));
  }, [list, cfg, assets, targets]);

  // Фонове листя, розставлене на попередньому кроці. Воно ще чернетка —
  // сервер його не бачив, тож playerInstances про нього не знає, і на кроці
  // «листя на чолі» кущ стояв голий (власник, 26.09.2026). А саме по ньому
  // й видно, що закриваєш передніми листками.
  const earlier = useMemo(() => {
    if (!assets || phase !== "leafFg") return [];
    const c = config(assets, "leafBg");
    return (items.bg ?? []).map((it) => resolve(it, { assets, cfg: c }));
  }, [assets, phase, items.bg]);

  // Сцена: кущ цільової стадії + уже посаджене + чернетка поверх.
  const instances = useMemo(() => {
    if (!assets || !data || !cfg) return [];
    const base = baseInstances(assets.layout, stage, "healthy")
      .map((i) => (i.group === "platform" ? { ...i, scale: i.scale * 0.72 } : i));
    const planted = playerInstances(data.appearance, stage, "healthy");
    const draft = (it, kind, z) => ({
      ...toStage(it), scale: it.scale * f, rotation: it.rotation,
      group: groupFor(kind), sprite: spriteFor(kind, it), z, draft: true,
    });
    const before = earlier.map((it, n) => draft(it, "leafBg", 18 + n * 0.001));
    // Нові бутони після посадки лягають поверх уже посаджених (FRUIT_FOREGROUND_Z
    // + порядковий номер, scene.js) — у чернетці так само, інакше прев'ю
    // показувало б їх під старими.
    const budsBefore = data.appearance?.buds?.length ?? 0;
    const drafts = resolved.map((it, n) => ({
      ...draft(it, phase, phase === "bud" ? FRUIT_FOREGROUND_Z + budsBefore + n : cfg.z + n * 0.001),
      pop: pop?.n === n,
    }));
    return [...base, ...planted, ...before, ...drafts].sort((a, b) => a.z - b.z);
  }, [assets, data, stage, resolved, earlier, phase, cfg, f, toStage, pop]);

  // Підсвічені зони й криві — у тих самих координатах, що й сцена.
  const zones = useMemo(() => {
    if (!cfg) return [];
    if (cfg.kind === "leafBg") {
      return [{ fill: true, active: true, d: `${smoothD(cfg.zone.polygon.map(toStage), true)} ${smoothD(cfg.zone.holePolygon.map(toStage), true)}` }];
    }
    if (cfg.kind === "leafFg") {
      return [
        { fill: true, active: true, d: smoothD(cfg.zone.polygon.map(toStage), true) },
        { ghost: true, d: smoothD(assets.placement.leafBg.polygon.map(toStage), true) },
      ];
    }
    if (cfg.kind === "branch") return [{ d: smoothD(cfg.curve.source.map(toStage), false), active: true }];
    return targets.map((t) => ({
      d: smoothD(t.curve.source.map(toStage), false),
      active: Boolean(list[selected]) && list[selected].owner === t.id,
    }));
  }, [cfg, assets, targets, list, selected, toStage]);

  // Куди взагалі можуть дістати листя й гілки: обидві зони листя й лінія
  // гілок, і від кожної точки — ще довжина найбільшого елемента (він
  // тягнеться від кореня назовні). Це рамка віддаленого масштабу.
  const reach = useMemo(() => {
    if (!assets) return [];
    const pts = [];
    for (const kind of ["leafBg", "leafFg", "branch"]) {
      const c = config(assets, kind);
      const r = W0 * (c.scale?.max ?? 1) * f * 0.6;
      const src = c.zone ? c.zone.polygon : c.curve?.source ?? [];
      for (const p0 of src) {
        const p = toStage(p0);
        pts.push({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r });
      }
    }
    return pts;
  }, [assets, f, toStage]);

  // Камера — як у макеті: зона й кущ (радіус 0.42 спрайта) з полями 26, але
  // рамка одна на всі панелі (CAMERA_PANEL_ROOM) і прив'язана до верху.
  const camera = useMemo(() => {
    if (!cfg) return { k: 0.45, tx: 0, ty: 0 };
    const pts = [];
    if (cfg.kind === "leafBg") for (const p of [...cfg.zone.polygon, ...cfg.zone.holePolygon]) pts.push(toStage(p));
    if (cfg.kind === "leafFg") for (const p of [...cfg.zone.polygon, ...assets.placement.leafBg.polygon]) pts.push(toStage(p));
    if (cfg.kind === "branch") for (const p of cfg.curve.source) pts.push(toStage(p));
    if (cfg.kind === "bud") for (const t of targets) for (const p of t.curve.source) pts.push(toStage(p));
    for (const i of instances) {
      if (!i.sprite || i.group === "platform" || i.group === "ground_shadow") continue;
      if (i.draft && !CAMERA_FOLLOWS_DRAFT) continue;
      const r = W0 * i.scale * 0.42;
      pts.push({ x: i.x - r, y: i.y - r }, { x: i.x + r, y: i.y + r });
    }
    if (zoomOut) pts.push(...reach);
    const room = wide
      ? { x: 10, y: CAMERA_TOP, w: box.w - CAMERA_PANEL_SIDE - 20, h: box.h - CAMERA_TOP - 10 }
      : { x: 10, y: CAMERA_TOP, w: box.w - 20, h: box.h - CAMERA_TOP - CAMERA_PANEL_ROOM };
    return fitCamera(pts, room, 26, { align: "top" });
  }, [cfg, assets, targets, instances, box, toStage, wide, zoomOut, reach]);

  // ── робота з елементами ───────────────────────────────────────────────
  const setList = (next) => setItems((prev) => ({ ...prev, [FIELD[phase]]: next }));
  const patch = (changes) => setList(list.map((it, i) => (i === selected ? { ...it, ...changes } : it)));

  const sceneAt = (e) => {
    const r = rootRef.current.getBoundingClientRect();
    return toMature({ x: (e.clientX - r.left - camera.tx) / camera.k, y: (e.clientY - r.top - camera.ty) / camera.k });
  };

  const dragging = useRef(false);
  // Де палець тримає елемент відносно його кореня. Раніше корінь стрибав
  // під палець у мить, коли елемент брали, — тягнути можна було лише «за
  // корінь» (власник, 28.09.2026). Тепер відстань зберігається, і листок
  // їде за пальцем, за яку б його точку не взяли.
  //
  // Саме від КОРЕНЯ (rootOf), а не від центру картинки: moveTo ставить у
  // точку корінь, і з відстанню до центру навіть тап без руху переносив
  // корінь туди, де був центр, — обраний листок відскакував від тіла
  // (власник, 01.10.2026).
  const grab = useRef({ dx: 0, dy: 0 });

  // Елемент під пальцем — той, у чиє біле коло влучив дотик: коло, що
  // підсвічує вибір, і є зоною дотику. Раніше брався найближчий КОРІНЬ у
  // радіусі 55 — листок обирався тапом під собою, а по краю ні, а коли
  // стояли всі 40, будь-який тап у порожнечу хапав найближчий (власник,
  // 26.09.2026). Кола в зрілих координатах, як і точка дотику. З кількох —
  // верхнє, бо саме його видно.
  const hitAt = (point) => {
    for (let i = resolved.length - 1; i >= 0; i--) {
      const it = resolved[i];
      if (Math.hypot(it.x - point.x, it.y - point.y) <= W0 * it.scale * ringOf(phase)) return i;
    }
    return -1;
  };

  const onDown = (e) => {
    if (!cfg || sheet === "confirm" || sheet === "intro" || sheet === "resume") return;
    const point = sceneAt(e);
    const hit = hitAt(point);
    if (hit >= 0) {
      setSelected(hit);
      const root = rootOf(list[hit], cfg, targets);
      grab.current = { dx: root.x - point.x, dy: root.y - point.y };
    } else if (list.length < max) {
      grab.current = { dx: 0, dy: 0 };   // новий — корінь саме там, де торкнулись
      const skin = list[selected]?.skin ?? 1;
      setList([...list, createAt(point, cfg, { skin, targets })]);
      setSelected(list.length);
      const box = rootRef.current.getBoundingClientRect();
      setPop({ n: list.length, x: e.clientX - box.left, y: e.clientY - box.top, id: Date.now() });
    } else {
      setSelected(null);   // усі поставлено, а тап у порожнечу — просто зняти вибір
      return;
    }
    setSheet("edit");
    dragging.current = true;
    // Захоплення вказівника іноді недоступне (синтетичні події, мишу вже
    // відпустили) — це не привід ронити обробник.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* пусте */ }
  };

  const onMove = (e) => {
    if (!dragging.current || selected === null) return;
    const p = sceneAt(e);
    const point = { x: p.x + grab.current.dx, y: p.y + grab.current.dy };
    setList(list.map((it, i) => (i === selected ? moveTo(it, point, cfg, targets) : it)));
  };

  const onUp = () => { dragging.current = false; };

  // Порядок серед своїх — це порядок у масиві (§7), тому «спереду» = в кінець.
  const reorder = (to) => {
    const next = [...list];
    const [moved] = next.splice(selected, 1);
    next.splice(to, 0, moved);
    setList(next);
    setSelected(to);
  };

  const remove = () => {
    setList(list.filter((_, i) => i !== selected));
    setSelected(null);
  };

  // ── чернетка ──────────────────────────────────────────────────────────
  const saveDraft = useRef(null);
  const pendingDraft = useRef(null);   // що саме чекає на відправку
  const putDraft = (draft) => api.put(`/me/plants/${id}/planting/draft`, { draft }).catch(() => {});

  useEffect(() => {
    if (!data || !phase) return undefined;
    const count = (items.bg?.length ?? 0) + (items.fg?.length ?? 0) + (items.branches?.length ?? 0) + (items.buds?.length ?? 0);
    const draft = count ? { kind: data.state.planting, phase, items, count } : null;
    pendingDraft.current = draft;
    clearTimeout(saveDraft.current);
    saveDraft.current = setTimeout(() => { pendingDraft.current = null; putDraft(draft); }, 700);
    return () => clearTimeout(saveDraft.current);
  }, [items, phase, data, id]);

  // Вихід з екрана не має коштувати останніх правок. Затримка в 700 мс
  // економить запити, поки людина розставляє листя, — але якщо після
  // останнього кліку одразу вийти в меню, cleanup гасив таймер, і робота
  // зникала. Саме так губилося фонове листя (26.09.2026, власник): запит
  // переживе розмонтування компонента, а відкладений таймер — ні.
  useEffect(() => () => { if (pendingDraft.current) putDraft(pendingDraft.current); }, []);

  // «Незавершена посадка» живе на вкладці кавенятка (HUD і меню на місці),
  // а далі редактор відкривається вже з кнопкою «Назад».
  const leaveResume = (next) => { setSheet(next); ctx.replace("planting", { plantId: id, title }); };

  const commit = async () => {
    setBusy(true);
    try {
      // Шлемо лише поля цієї посадки (сервер інших і не садить).
      const all = { bg: items.bg, fg: skipFg ? [] : items.fg, branches: items.branches, buds: items.buds };
      const own = Object.fromEntries(PHASES[data.state.planting].map((p) => [FIELD[p], all[FIELD[p]]]));
      // Готові координати рахує клієнт: сервер геометрію не перевіряє (§9).
      // Порожні поля теж ідуть — сервер рахує їх кількість.
      const payload = { items: { ...own, ...resolveDraft(assets, own, data.appearance?.branches) } };
      await api.post(`/me/plants/${id}/planting`, payload);
      // Посаджене — вже не чернетка. Гасимо і таймер, і те, що чекало на
      // відправку: інакше flush при виході воскресив би її на сервері, і
      // кавенятко знову просило б «продовжити незавершену посадку».
      clearTimeout(saveDraft.current);
      pendingDraft.current = null;
      // Екран кавенятка покаже перехід: старий кущ, препарат над ним, новий.
      leaveHandoff({ plantId: id, kind: need, from: data.state.from, to: data.state.to, appearance: data.appearance });
      await ctx.refreshMe();
      ctx.pop();
    } catch (e) {
      const body = e.body ?? {};
      if (body.error === "bad_count") {
        // Не зійшлось поле іншого кроку (фонове листя, поки ти на «чолі»)
        // — ведемо туди, де його можна виправити, а не лишаємо з кнопкою,
        // яка щоразу відмовлятиме.
        const back = PHASE_OF_FIELD[body.key];
        if (back && back !== phase) { setPhase(back); setSelected(null); }
        setError(badCount(body));
        setSheet("edit");
        setSkipFg(false);   // не лишаємо людину в режимі пропуску після помилки
      } else {
        // Решту причин пишемо в самій картці: рядок під панеллю після її
        // закриття легко не помітити, і «Посадити» виглядало кнопкою, яка
        // нічого не робить (власник, 01.10.2026).
        setError(ERRORS[body.error] ?? errText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!assets || !data || !cfg) return <div className="stage-pad"><div className="skeleton" /></div>;
  if (!data.state.planting) {
    return <div className="stage-pad"><div className="panel">Зараз садити нічого – кавенятко просить догляду.</div></div>;
  }

  const need = data.state.need;
  const what = WHAT[data.state.planting];
  const supplyLeft = data.supply?.[CARE[need].key] ?? 0;
  const item = selected !== null ? list[selected] : null;
  const enough = list.length >= min;
  const skinSrc = (n) => `/assets/sprites/${cfg.group}/${spriteFor(phase, { skin: n })}`;
  const sw = 2.9 / camera.k;
  const drafted = (items.bg?.length ?? 0) + (items.fg?.length ?? 0) + (items.branches?.length ?? 0) + (items.buds?.length ?? 0);
  const unit = `1 ${CARE[need].unit}`;
  const planted = phase === "bud" ? data.appearance?.buds?.length ?? 0 : 0;

  const mainButton = () => {
    if (phase === "leafBg") {
      return <button className="pl-btn" disabled={!enough} onClick={() => { setPhase("leafFg"); setSelected(null); setSheet("intro"); }}>Наступний крок</button>;
    }
    const label = phase === "branch" ? `посадити ${list.length} ${plural(list.length, "гілку", "гілки", "гілок")}`
      : phase === "bud" ? `посадити ${list.length}` : "посадити";
    const plant = (
      <button className="pl-btn" disabled={!enough} onClick={() => { setError(null); setSheet("confirm"); }}>
        <CareIcon need={need} h={phase === "bud" ? 21 : 20} />{unit}<i className="vsep" />{label}
      </button>
    );
    if (phase !== "leafFg") return plant;
    return (
      <div className="pl-pair">
        {/* Не стираємо розставлене: якщо посадка впаде (немає препарату,
            не та кількість), листя має лишитись на місці. Пропуск — це
            намір, який враховує commit, а не видалення роботи наперед. */}
        <button className="pl-btn ghost" onClick={() => { setSkipFg(true); setSelected(null); setError(null); setSheet("confirm"); }}>Пропустити</button>
        {plant}
      </div>
    );
  };

  return (
    <div className="pl" ref={rootRef}>
      <div className="pl-touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <Scene instances={instances} layout={assets.layout} camera={camera}>
        <svg viewBox="0 0 1000 1300" width={1000} height={1300}
             style={{ position: "absolute", left: 0, top: 0, overflow: "visible", zIndex: 2000,
                      animation: sheet === "resume" ? "zonePulse 1.7s ease-in-out infinite" : undefined }}>
          {zones.map((z, i) => {
            if (z.ghost) return <path key={i} d={z.d} fill="none" stroke="rgba(139,148,163,.40)" strokeWidth={sw * 0.45} />;
            const col = z.active ? "#FFC073" : "#FE810B";
            if (z.fill) {
              return (
                <g key={i}>
                  <path d={z.d} fill="rgba(254,129,11,.28)" fillRule="evenodd" stroke="none" />
                  <path d={z.d} fill="none" fillRule="evenodd" stroke={col} strokeWidth={sw * 0.5} />
                </g>
              );
            }
            return (
              <g key={i}>
                {/* темний контур під лінією — щоб крива читалася поверх листя */}
                <path d={z.d} fill="none" stroke="rgba(6,8,10,.75)" strokeWidth={sw * (z.active ? 3 : 2.5)} strokeLinecap="round" />
                {z.active && <path d={z.d} fill="none" stroke="rgba(255,162,58,.28)" strokeWidth={sw * 5} strokeLinecap="round" />}
                <path d={z.d} fill="none" stroke={col} strokeWidth={z.active ? sw * 1.35 : sw} strokeLinecap="round" />
              </g>
            );
          })}
          {item && sheet !== "confirm" && (() => {
            const r = resolved[selected];
            const p = toStage({ x: r.x, y: r.y });
            return <circle cx={p.x} cy={p.y} r={W0 * r.scale * f * ringOf(phase)}
                           fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.72)" strokeWidth={sw * 0.5} />;
          })()}
        </svg>
      </Scene>
      {pop && <Sparks key={pop.id} kind={POP_SPARKS[phase]} x={pop.x} y={pop.y} delay={120} />}

      {sheet !== "intro" && sheet !== "confirm" && (
        <div className="pl-chips">
          <CounterChip icon={ICON[phase][0]} iconSize={ICON[phase][1]} count={planted + list.length}
                       max={phase === "bud" ? BUDS_TOTAL : max} min={planted + min} bar={phase === "leafBg"} minLabel={phase === "branch"} />
          <div className="pl-tag">{sheet === "resume" ? "Чернетка" : PHASE[phase].label}</div>
        </div>
      )}

      {sheet !== "confirm" && (
        <div className="pl-sheet" data-kind={sheet}>
          {sheet === "resume" && (
            <>
              <b className="pl-sheet-title">Ти вже почав садити {what.verb}</b>
              <p>{drafted} {what.count(drafted)} уже посаджено, <CareIcon need={need} h={16} style={{ display: "inline", verticalAlign: -3 }} /> ще не списано</p>
              <div className="pl-pair">
                {/* Разом із листям скидаємо й КРОК. Інакше «почати заново» на
                    другому кроці стирало фонове листя, лишаючи тебе на
                    передньому: посадити фонове вже нема де, а сервер вимагає
                    його кількість — і кавенятко застрягало назавжди, тільки
                    скосити (26.09.2026, власник). */}
                <button className="pl-btn ghost" onClick={() => { setItems(EMPTY); setSelected(null); setPhase(firstPhase); leaveResume("intro"); }}>Почати заново</button>
                <button className="pl-btn" onClick={() => leaveResume("edit")}>Продовжити</button>
              </div>
            </>
          )}

          {sheet === "intro" && (
            <>
              <b className="pl-title">{PHASE[phase].introTitle}</b>
              <Steps items={phase === "bud" ? [...PHASE.bud.intro, budsNow(planted, min)] : PHASE[phase].intro} />
              <button className="pl-btn go" onClick={() => setSheet("edit")}>Почати!</button>
            </>
          )}

          {sheet === "skins" && (
            <>
              <SkinGrid count={cfg.skins} value={item?.skin ?? 1} src={skinSrc} wide={phase === "branch"}
                        onChange={(n) => patch({ skin: n })} />
              <button className="pl-btn" onClick={() => setSheet("edit")}>Обрати</button>
            </>
          )}

          {sheet === "edit" && (
            <>
              <button className="pl-zoom" data-shift={item ? "1" : undefined}
                      aria-label={zoomOut ? "Наблизити" : "Віддалити"} title={zoomOut ? "Наблизити" : "Віддалити"}
                      onClick={() => setZoomOut((z) => !z)}>
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /><path d="M7.8 10.5h5.4" />
                  {zoomOut && <path d="M10.5 7.8v5.4" />}
                </svg>
              </button>
              {item ? (
                <>
                  <button className="pl-del" aria-label="Видалити" onClick={remove}><Trash /></button>
                  {cfg.skins > 0 && (
                    <button className="pl-skinpick" onClick={() => setSheet("skins")}>
                      <img src={skinSrc(item.skin ?? 1)} alt={`скін ${item.skin ?? 1}`} />
                      <span>Обрати скін</span>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round"><path d="M9.5 6 15.5 12 9.5 18" /></svg>
                    </button>
                  )}
                  <div className="pl-edit">
                    <Dial value={cfg.free360 ? item.angle ?? 0 : item.offset ?? 0} min={cfg.rotation.min} max={cfg.rotation.max}
                          onChange={(v) => patch(cfg.free360 ? { angle: v } : { offset: v })} />
                    <div className="pl-ranges">
                      <RangeRow label="Розмір" value={item.scale} display={item.scale.toFixed(2)}
                                min={cfg.scale.min} max={cfg.scale.max} onChange={(v) => patch({ scale: v })} />
                      {/* «з N» — скільки їх уже є разом із цими, а не 7 за життя:
                          переставляти можна лише серед посаджених, і перший
                          бутон на «1 з 7» не мав куди рухатись (власник, 26.09.2026). */}
                      <ZOrderRow index={selected} total={list.length} offset={planted} onChange={reorder} />
                    </div>
                  </div>
                </>
              ) : (
                // Скільки треба й скільки поставлено — у лічильнику вгорі;
                // тут це дублювалось (власник, 26.09.2026).
                <p>{cfg.mode === "area" ? "Доторкнися до підсвіченої зони, щоб посадити." : "Доторкнися до підсвіченої лінії, щоб посадити."}</p>
              )}
              {error && <p style={{ color: "var(--accent-text)" }}>{error}</p>}
              {mainButton()}
            </>
          )}
        </div>
      )}

      {sheet === "confirm" && (
        <>
          {host && createPortal(<div className="sheet-backdrop" onClick={() => { setSheet("edit"); setSkipFg(false); setError(null); }} />, host)}
          <div className="care-card">
            <div className="care-card-head">
              <CareIcon need={need} h={47} />
              <b>{what.forever}</b>
            </div>
            <p>Використати {unit} {CARE[need].of}? Після посадки {what.move} вже не можна.</p>
            <div className="care-card-row">
              <span>{CARE[need].stock}</span>
              <b>{supplyLeft} {CARE[need].unit} → {Math.max(0, supplyLeft - 1)} {CARE[need].unit}</b>
            </div>
            {error && <p style={{ color: "var(--accent-text)", fontWeight: 700 }}>{error}</p>}
            <div className="care-card-btns">
              <button onClick={() => { setSheet("edit"); setSkipFg(false); setError(null); }}>Ще ні</button>
              <button disabled={busy || supplyLeft < 1} onClick={commit}>{busy ? "Саджаємо…" : "Посадити"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
