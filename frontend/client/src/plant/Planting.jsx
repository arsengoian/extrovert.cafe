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
import { api } from "../api.js";
import { plural } from "../ui/plural.js";
import { Scene } from "./Scene.jsx";
import { usePlantAssets } from "./assets.js";
import { W0, fitCamera, growthFactor, smoothD } from "./geometry.js";
import { ANCHOR, baseInstances, playerInstances } from "./scene.js";
import { budTargets, config, createAt, groupFor, moveTo, resolve, spriteFor } from "./placement.js";
import { CounterChip, Dial, RangeRow, SkinGrid, Steps, ZOrderRow } from "./controls.jsx";

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
    intro: ["Бутон чіпляється до тіла або будь-якої посадженої гілки.",
            "Просто тягни його – він сам розташується, де потрібно.",
            "Усього їх буде 7, по 1–2 за раз на кожній стадії росту."],
  },
};

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

const ERRORS = {
  no_supply: "Не вистачає препарату",
  too_soon: "Одна стадія на добу – посадка відкриється завтра",
  bad_count: "Кількість не збігається з умовою",
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
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const [box, setBox] = useState({ w: 390, h: 602 });
  const [sheetH, setSheetH] = useState(220);
  const [host, setHost] = useState(null);
  useEffect(() => setHost(document.querySelector(".app")), []);

  const id = plantId ?? ctx.me?.plants?.[0]?.id;

  useEffect(() => {
    api.get(`/me/plants/${id}/planting`)
      .then((d) => {
        setData(d);
        const first = d.state.planting === "leaves" ? "leafBg" : d.state.planting === "branches" ? "branch" : "bud";
        const draft = d.draft;
        setPhase(draft?.phase ?? first);
        if (draft?.items) { setItems({ ...EMPTY, ...draft.items }); setSheet(resume ? "resume" : "edit"); }
      })
      .catch((e) => setError(e.body?.error ?? e.message));
  }, [id]);

  // Кадр підганяється під реальний розмір сцени й панелі: у браузері на ПК і
  // на телефоні це різні числа, а панель у кожного кроку своєї висоти.
  useLayoutEffect(() => {
    const measure = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setBox({ w: r.width, h: r.height });
      if (sheetRef.current) setSheetH(sheetRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    if (sheetRef.current) ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, [data, sheet, selected, phase]);

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

  // Сцена: кущ цільової стадії + уже посаджене + чернетка поверх.
  const instances = useMemo(() => {
    if (!assets || !data || !cfg) return [];
    const base = baseInstances(assets.layout, stage, "healthy")
      .map((i) => (i.group === "platform" ? { ...i, scale: i.scale * 0.72 } : i));
    const planted = playerInstances(data.appearance, stage, "healthy");
    const drafts = resolved.map((it, n) => ({
      ...toStage(it), scale: it.scale * f, rotation: it.rotation,
      group: groupFor(phase === "leafFg" ? "leafBg" : phase), sprite: spriteFor(phase, it),
      z: cfg.z + n * 0.001,
    }));
    return [...base, ...planted, ...drafts].sort((a, b) => a.z - b.z);
  }, [assets, data, stage, resolved, phase, cfg, f, toStage]);

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

  // Камера — як у макеті: зона й кущ (радіус 0.42 спрайта) з полями 26 у
  // прямокутнику над панеллю. Верх — під лічильником (40), на «як це
  // працює» лічильника нема (24), у чернетці рамка ширша (16).
  const vp = sheet === "resume" ? { x: 12, y: 16 } : sheet === "intro" ? { x: 10, y: 24 } : { x: 10, y: 40 };
  const camera = useMemo(() => {
    if (!cfg) return { k: 0.45, tx: 0, ty: 0 };
    const pts = [];
    if (cfg.kind === "leafBg") for (const p of [...cfg.zone.polygon, ...cfg.zone.holePolygon]) pts.push(toStage(p));
    if (cfg.kind === "leafFg") for (const p of [...cfg.zone.polygon, ...assets.placement.leafBg.polygon]) pts.push(toStage(p));
    if (cfg.kind === "branch") for (const p of cfg.curve.source) pts.push(toStage(p));
    if (cfg.kind === "bud") for (const t of targets) for (const p of t.curve.source) pts.push(toStage(p));
    for (const i of instances) {
      if (!i.sprite || i.group === "platform" || i.group === "ground_shadow") continue;
      const r = W0 * i.scale * 0.42;
      pts.push({ x: i.x - r, y: i.y - r }, { x: i.x + r, y: i.y + r });
    }
    return fitCamera(pts, { x: vp.x, y: vp.y, w: box.w - 2 * vp.x, h: box.h - vp.y - sheetH - 8 }, 26);
  }, [cfg, assets, targets, instances, box, sheetH, toStage, vp.x, vp.y]);

  // ── робота з елементами ───────────────────────────────────────────────
  const setList = (next) => setItems((prev) => ({ ...prev, [FIELD[phase]]: next }));
  const patch = (changes) => setList(list.map((it, i) => (i === selected ? { ...it, ...changes } : it)));

  const sceneAt = (e) => {
    const r = rootRef.current.getBoundingClientRect();
    return toMature({ x: (e.clientX - r.left - camera.tx) / camera.k, y: (e.clientY - r.top - camera.ty) / camera.k });
  };

  const dragging = useRef(false);

  const onDown = (e) => {
    if (!cfg || sheet === "confirm" || sheet === "intro" || sheet === "resume") return;
    const point = sceneAt(e);
    // Спершу шукаємо, чи не влучив палець у вже поставлений елемент.
    let hit = -1, hitD = Infinity;
    resolved.forEach((it, i) => {
      const d = Math.hypot(it.root.x - point.x, it.root.y - point.y);
      if (d < hitD) { hitD = d; hit = i; }
    });
    if (hitD < 55) {
      setSelected(hit);
    } else if (list.length < max) {
      const skin = list[selected]?.skin ?? 1;
      setList([...list, createAt(point, cfg, { skin, targets })]);
      setSelected(list.length);
    } else {
      setSelected(hit >= 0 ? hit : null);
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
    const point = sceneAt(e);
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
  useEffect(() => {
    if (!data || !phase) return undefined;
    clearTimeout(saveDraft.current);
    saveDraft.current = setTimeout(() => {
      const count = (items.bg?.length ?? 0) + (items.fg?.length ?? 0) + (items.branches?.length ?? 0) + (items.buds?.length ?? 0);
      const draft = count ? { kind: data.state.planting, phase, items, count } : null;
      api.put(`/me/plants/${id}/planting/draft`, { draft }).catch(() => {});
    }, 700);
    return () => clearTimeout(saveDraft.current);
  }, [items, phase, data, id]);

  // «Незавершена посадка» живе на вкладці кавенятка (HUD і меню на місці),
  // а далі редактор відкривається вже з кнопкою «Назад».
  const leaveResume = (next) => { setSheet(next); ctx.replace("planting", { plantId: id, title }); };

  const commit = async () => {
    setBusy(true);
    try {
      const payload = { items: { bg: items.bg, fg: items.fg, branches: items.branches, buds: items.buds } };
      // Готові координати рахує клієнт: сервер геометрію не перевіряє (§9).
      for (const [key, kind] of [["bg", "leafBg"], ["fg", "leafFg"], ["branches", "branch"], ["buds", "bud"]]) {
        const list2 = payload.items[key];
        if (!list2?.length) continue;
        const c = config(assets, kind);
        const t = kind === "bud" ? budTargets(assets, data.appearance?.branches ?? []) : null;
        payload.items[key] = list2.map((it) => resolve(it, { assets, cfg: c, targets: t }));
      }
      await api.post(`/me/plants/${id}/planting`, payload);
      await ctx.refreshMe();
      ctx.pop();
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? e.body?.error ?? e.message);
      setSheet("edit");
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
      <button className="pl-btn" disabled={!enough} onClick={() => setSheet("confirm")}>
        <CareIcon need={need} h={phase === "bud" ? 21 : 20} />{unit} · {label}
      </button>
    );
    if (phase !== "leafFg") return plant;
    return (
      <div className="pl-pair">
        <button className="pl-btn ghost" onClick={() => { setList([]); setSelected(null); setSheet("confirm"); }}>Пропустити</button>
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
            return <circle cx={p.x} cy={p.y} r={W0 * r.scale * f * (phase === "bud" ? 0.42 : 0.44)}
                           fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.72)" strokeWidth={sw * 0.5} />;
          })()}
        </svg>
      </Scene>

      {sheet !== "intro" && sheet !== "confirm" && (
        <div className="pl-chips">
          <CounterChip icon={ICON[phase][0]} iconSize={ICON[phase][1]} count={planted + list.length}
                       max={phase === "bud" ? BUDS_TOTAL : max} min={planted + min} bar={phase === "leafBg"} minLabel={phase === "branch"} />
          <div className="pl-tag">{sheet === "resume" ? "Чернетка" : PHASE[phase].label}</div>
        </div>
      )}

      {sheet !== "confirm" && (
        <div className="pl-sheet" data-kind={sheet} ref={sheetRef}>
          {sheet === "resume" && (
            <>
              <b className="pl-sheet-title">Ти вже почав садити {what.verb}</b>
              <p>{drafted} {what.count(drafted)} уже посаджено, <CareIcon need={need} h={16} style={{ display: "inline", verticalAlign: -3 }} /> ще не списано</p>
              <div className="pl-pair">
                <button className="pl-btn ghost" onClick={() => { setItems(EMPTY); setSelected(null); leaveResume("intro"); }}>Почати заново</button>
                <button className="pl-btn" onClick={() => leaveResume("edit")}>Продовжити</button>
              </div>
            </>
          )}

          {sheet === "intro" && (
            <>
              <b className="pl-title">{PHASE[phase].introTitle}</b>
              <Steps items={PHASE[phase].intro} />
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
                      <ZOrderRow index={selected} total={list.length} offset={planted} of={phase === "bud" ? BUDS_TOTAL : undefined} onChange={reorder} />
                    </div>
                  </div>
                </>
              ) : (
                <p>
                  {cfg.mode === "area" ? "Доторкнися до підсвіченої зони, щоб посадити." : "Доторкнися до підсвіченої лінії, щоб посадити."}
                  {" "}Треба {min === max ? min : `від ${min} до ${max}`}, поставлено {list.length}.
                </p>
              )}
              {error && <p style={{ color: "var(--accent-text)" }}>{error}</p>}
              {mainButton()}
            </>
          )}
        </div>
      )}

      {sheet === "confirm" && (
        <>
          {host && createPortal(<div className="sheet-backdrop" onClick={() => setSheet("edit")} />, host)}
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
            <div className="care-card-btns">
              <button onClick={() => setSheet("edit")}>Ще ні</button>
              <button disabled={busy || supplyLeft < 1} onClick={commit}>{busy ? "Саджаємо…" : "Посадити"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
