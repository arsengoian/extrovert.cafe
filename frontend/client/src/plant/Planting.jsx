// Екрани посадки: листя (фон і чоло), гілки, бутони. Один компонент на всі
// чотири типи — різниця тільки в конфізі з placement.js і в підписах, тож
// поведінка (тап = створити або обрати, тяг = рухати, панель знизу)
// однакова скрізь, як і в дизайні.
//
// Поки не натиснуто «Посадити», нічого не списано: чернетка їде на сервер у
// appearance.draft (docs/bush_planting_ui.md §1).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { Scene } from "./Scene.jsx";
import { usePlantAssets } from "./assets.js";
import { W0, fitCamera, growthFactor, smoothD } from "./geometry.js";
import { ANCHOR, baseInstances, playerInstances } from "./scene.js";
import { budTargets, config, createAt, groupFor, moveTo, resolve, spriteFor } from "./placement.js";
import { CounterChip, Dial, RangeRow, SkinGrid, Steps, ZOrderRow } from "./controls.jsx";

const CARE_ICON = { compost: "/assets/ui/compost.png", fertilizer: "/assets/ui/mineral.png", insecticide: "/assets/ui/insecticide.png" };
const CARE_NAME = { compost: "компост", fertilizer: "добриво", insecticide: "інсектицид" };
// «Використати 1 кг компосту» — родовий відмінок, бо в називному виходить
// «1 кг компост».
const CARE_OF = { compost: "компосту", fertilizer: "добрива", insecticide: "інсектициду" };
const careUnit = (need) => (need === "insecticide" ? "1 флакон" : "1 кг");

const PHASE = {
  leafBg: {
    title: "Посадка листя", counter: "Листки",
    intro: ["Доторкнися до підсвіченої зони, щоб посадити новий листок з обраним скіном.",
            "Тягни його, крути й міняй розмір, а щоб відредагувати інший – доторкнися до нього.",
            "Треба від 20 до 40 листків. Поки ти не натиснеш «Посадити», компост не спишеться."],
    introTitle: "Одягни кавенятко в листя",
  },
  leafFg: {
    title: "Посадка листя", counter: "Листки",
    intro: ["Ці листки малюються поверх кавенятка й закривають частину тіла.",
            "Кут тут вільний, 0–359° – крути як завгодно.",
            "Крок необов'язковий: можна поставити до 5 листків або пропустити."],
    introTitle: "Тепер листя спереду",
  },
  branch: {
    title: "Посадка гілок", counter: "Гілки",
    intro: ["Гілка кріпиться коренем до дуги – тягни вздовж неї, точка підбереться сама.",
            "Доторкнися до порожнього місця, щоб створити нову гілку, або до існуючої гілки – щоб обрати.",
            "Потрібно посадити від 2 до 4 гілок."],
    introTitle: "Додай кавенятку гілки",
  },
  bud: {
    title: "Посадка бутонів", counter: "Бутони",
    intro: ["Бутон чіпляється до тіла або будь-якої посадженої гілки.",
            "Просто тягни його – він сам розташується, де потрібно.",
            "Усього їх буде 7, по 1–2 за раз на кожній стадії росту."],
    introTitle: "Час для бутонів",
  },
};

const ICON = {
  leafBg: "/assets/sprites/leaves_batch_normal/leaf_skin1_normal.png",
  leafFg: "/assets/sprites/leaves_batch_normal/leaf_skin1_normal.png",
  branch: "/assets/sprites/branch_skins_custom/branch_custom_skin1.png",
  bud: "/assets/sprites/fruit_bud_greenbean/fruit_bud.png",
};

// Який тип садимо зараз і в якому полі це поїде на сервер.
const FIELD = { leafBg: "bg", leafFg: "fg", branch: "branches", bud: "buds" };

const ERRORS = {
  no_supply: "Не вистачає препарату",
  too_soon: "Одна стадія на добу — посадка відкриється завтра",
  bad_count: "Кількість не збігається з умовою",
  nothing_to_plant: "Зараз садити нічого",
  on_sale: "Кавенятко виставлене на продаж",
};

export function Planting({ ctx, plantId }) {
  const assets = usePlantAssets();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(null);           // leafBg | leafFg | branch | bud
  const [items, setItems] = useState({ bg: [], fg: [], branches: [], buds: [] });
  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState("intro");        // intro | edit | skins | confirm | resume
  const [busy, setBusy] = useState(false);
  const stageRef = useRef(null);
  const [box, setBox] = useState({ w: 360, h: 380 });

  const id = plantId ?? ctx.me?.plants?.[0]?.id;

  useEffect(() => {
    api.get(`/me/plants/${id}/planting`)
      .then((d) => {
        setData(d);
        const first = d.state.planting === "leaves" ? "leafBg" : d.state.planting === "branches" ? "branch" : "bud";
        const draft = d.draft;
        setPhase(draft?.phase ?? first);
        if (draft?.items) { setItems({ bg: [], fg: [], branches: [], buds: [], ...draft.items }); setSheet("resume"); }
      })
      .catch((e) => setError(e.body?.error ?? e.message));
  }, [id]);

  // Кадр підганяється під реальний розмір сцени, а не під зашиті 390×844:
  // у браузері на ПК і на телефоні це різні числа.
  useEffect(() => {
    if (!stageRef.current) return undefined;
    const measure = () => {
      const r = stageRef.current?.getBoundingClientRect();
      if (r) setBox({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [data]);

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
    if (!assets || !data) return [];
    const base = baseInstances(assets.layout, stage, "healthy")
      .map((i) => (i.group === "platform" ? { ...i, scale: i.scale * 0.72 } : i));
    const planted = playerInstances(data.appearance, stage, "healthy");
    const drafts = resolved.map((it, n) => ({
      ...toStage(it), scale: it.scale * f, rotation: it.rotation,
      group: groupFor(phase === "leafFg" ? "leafBg" : phase), sprite: spriteFor(phase, it),
      z: cfg.z + n * 0.001, opacity: selected === n ? 1 : 0.96,
    }));
    return [...base, ...planted, ...drafts].sort((a, b) => a.z - b.z);
  }, [assets, data, stage, resolved, phase, cfg, selected, f, toStage]);

  // Підсвічені зони й криві — у тих самих координатах, що й сцена.
  const zones = useMemo(() => {
    if (!cfg) return [];
    if (cfg.kind === "leafBg") {
      return [{ fill: true, d: `${smoothD(cfg.zone.polygon.map(toStage), true)} ${smoothD(cfg.zone.holePolygon.map(toStage), true)}` }];
    }
    if (cfg.kind === "leafFg") {
      return [
        { ghost: true, d: smoothD(assets.placement.leafBg.polygon.map(toStage), true) },
        { fill: true, d: smoothD(cfg.zone.polygon.map(toStage), true) },
      ];
    }
    if (cfg.kind === "branch") return [{ d: smoothD(cfg.curve.source.map(toStage), false), active: true }];
    return targets.map((t) => ({
      d: smoothD(t.curve.source.map(toStage), false),
      active: !list[selected] || list[selected].owner === t.id,
    }));
  }, [cfg, assets, targets, list, selected, toStage]);

  const camera = useMemo(() => {
    const pts = [];
    if (cfg?.kind === "leafBg" || cfg?.kind === "leafFg") {
      for (const p of assets.placement.leafBg.polygon) pts.push(toStage(p));
    }
    if (cfg?.kind === "branch") for (const p of cfg.curve.source) pts.push(toStage(p));
    if (cfg?.kind === "bud") for (const t of targets) for (const p of t.curve.source) pts.push(toStage(p));
    for (const i of instances) {
      if (!i.sprite || i.group === "platform") continue;
      const r = (W0 * i.scale) / 2;
      pts.push({ x: i.x - r, y: i.y - r }, { x: i.x + r, y: i.y + r });
    }
    return fitCamera(pts, { x: 0, y: 0, w: box.w, h: box.h }, 18);
  }, [cfg, assets, targets, instances, box, toStage]);

  // ── робота з елементами ───────────────────────────────────────────────
  const setList = (next) => setItems((prev) => ({ ...prev, [FIELD[phase]]: next }));
  const patch = (changes) => setList(list.map((it, i) => (i === selected ? { ...it, ...changes } : it)));

  const sceneAt = (e) => {
    const r = stageRef.current.getBoundingClientRect();
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
    const near = hitD < 55;
    if (near) {
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
    setSheet("edit");
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
    return <div className="stage-pad"><div className="panel">Зараз садити нічого — кавенятко просить догляду.</div></div>;
  }

  const need = data.state.need;
  const supplyLeft = data.supply?.[need === "compost" ? "compost_kg" : need === "fertilizer" ? "fertilizer_kg" : "insecticide_bottles"] ?? 0;
  const item = selected !== null ? list[selected] : null;
  const enough = phase === "leafBg" ? list.length >= min : list.length >= min;
  const skinSrc = (n) => `/assets/sprites/${cfg.group}/${spriteFor(phase, { skin: n })}`;

  const mainButton = () => {
    if (phase === "leafBg") {
      return <button className="btn btn-primary" disabled={!enough} onClick={() => { setPhase("leafFg"); setSelected(null); setSheet("intro"); }}>
        Наступний крок
      </button>;
    }
    const label = phase === "branch" ? `посадити ${list.length} гілки` : phase === "bud" ? `посадити ${list.length}` : "посадити";
    return (
      <div className="row" style={{ gap: 10 }}>
        {phase === "leafFg" && (
          <button className="btn" style={{ flex: 1 }} onClick={() => { setList([]); setSheet("confirm"); }}>Пропустити</button>
        )}
        <button className="btn btn-primary" style={{ flex: 1.5 }} disabled={!enough} onClick={() => setSheet("confirm")}>
          <img src={CARE_ICON[need]} alt="" style={{ width: 14 }} />{careUnit(need)} · {label}
        </button>
      </div>
    );
  };

  return (
    <div className="planting">
      <div className="planting-stage" ref={stageRef}
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <Scene instances={instances} layout={assets.layout} camera={camera}>
          <svg viewBox={`0 0 1000 1300`} width={1000} height={1300}
               style={{ position: "absolute", left: 0, top: 0, overflow: "visible", zIndex: 2000, pointerEvents: "none" }}>
            {zones.map((z, i) => {
              if (z.ghost) return <path key={i} d={z.d} fill="none" stroke="rgba(139,148,163,.40)" strokeWidth={1.4 / camera.k} />;
              if (z.fill) {
                return (
                  <g key={i}>
                    <path d={z.d} fill="rgba(254,129,11,.28)" fillRule="evenodd" />
                    <path d={z.d} fill="none" fillRule="evenodd" stroke="#FFC073" strokeWidth={1.6 / camera.k} />
                  </g>
                );
              }
              return (
                <g key={i}>
                  <path d={z.d} fill="none" stroke="rgba(6,8,10,.75)" strokeWidth={(z.active ? 9 : 7) / camera.k} strokeLinecap="round" />
                  <path d={z.d} fill="none" stroke={z.active ? "#FFC073" : "#FE810B"}
                        strokeWidth={(z.active ? 4 : 3) / camera.k} strokeLinecap="round" />
                </g>
              );
            })}
            {item && (() => {
              const r = resolved[selected];
              const p = toStage({ x: r.x, y: r.y });
              return <circle cx={p.x} cy={p.y} r={(W0 * r.scale * f * 0.44)} fill="rgba(255,255,255,.18)"
                             stroke="rgba(255,255,255,.72)" strokeWidth={1.6 / camera.k} />;
            })()}
          </svg>
        </Scene>

        <CounterChip icon={ICON[phase]} count={list.length} max={max} min={phase === "leafBg" ? min : 0}
                     dots={phase !== "leafBg"} label={PHASE[phase].counter} />
      </div>

      <div className="planting-sheet">
        {sheet === "resume" && (
          <>
            <div className="h2">Ти вже почав садити</div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {(items.bg?.length ?? 0) + (items.fg?.length ?? 0) + (items.branches?.length ?? 0) + (items.buds?.length ?? 0)} елементів
              у чернетці, <img src={CARE_ICON[need]} alt="" style={{ width: 11, verticalAlign: -2 }} /> ще не списано
            </p>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => { setItems({ bg: [], fg: [], branches: [], buds: [] }); setSheet("intro"); }}>
                Почати заново
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setSheet("edit")}>Продовжити</button>
            </div>
          </>
        )}

        {sheet === "intro" && (
          <>
            <div className="h2">{PHASE[phase].introTitle}</div>
            <Steps items={PHASE[phase].intro} />
            <button className="btn btn-primary" onClick={() => setSheet("edit")}>Почати!</button>
          </>
        )}

        {sheet === "skins" && (
          <>
            <SkinGrid count={cfg.skins} value={item?.skin ?? 1} src={skinSrc}
                      onChange={(n) => patch({ skin: n })} />
            <button className="btn btn-primary" onClick={() => setSheet("edit")}>Обрати</button>
          </>
        )}

        {sheet === "edit" && (
          <>
            {item ? (
              <>
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn btn-icon btn-danger" aria-label="Видалити" onClick={remove}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" />
                      <path d="M7 7v12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8V7" />
                    </svg>
                  </button>
                  {cfg.skins > 0 && (
                    <button className="btn" style={{ flex: 1, justifyContent: "flex-start", gap: 10 }} onClick={() => setSheet("skins")}>
                      <img src={skinSrc(item.skin ?? 1)} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
                      <span style={{ flex: 1, textAlign: "left" }}>Обрати скін</span>
                      <span className="muted">›</span>
                    </button>
                  )}
                </div>
                <div className="row" style={{ gap: 14, alignItems: "flex-start", marginTop: 12 }}>
                  <Dial
                    value={cfg.free360 ? item.angle ?? 0 : item.offset ?? 0}
                    min={cfg.rotation.min} max={cfg.rotation.max}
                    hint={cfg.free360 ? "0–359°" : `±${cfg.rotation.max}°`}
                    onChange={(v) => patch(cfg.free360 ? { angle: v } : { offset: v })}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RangeRow label="Розмір" value={item.scale} display={item.scale.toFixed(2)}
                              min={cfg.scale.min} max={cfg.scale.max} onChange={(v) => patch({ scale: v })} />
                    <ZOrderRow index={selected} total={list.length} onChange={reorder} />
                  </div>
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, margin: "2px 0 12px" }}>
                {cfg.mode === "area" ? "Доторкнися до підсвіченої зони, щоб посадити." : "Доторкнися до підсвіченої лінії, щоб посадити."}
                {" "}Треба {min === max ? min : `від ${min} до ${max}`}, поставлено {list.length}.
              </p>
            )}
            {error && <div className="muted" style={{ color: "var(--accent-text)", fontSize: 12, margin: "8px 0" }}>{error}</div>}
            <div style={{ marginTop: 12 }}>{mainButton()}</div>
          </>
        )}

        {sheet === "confirm" && (
          <>
            <div className="row" style={{ gap: 10 }}>
              <img src={CARE_ICON[need]} alt="" style={{ width: 22 }} />
              <div style={{ fontWeight: 800 }}>
                {phase === "branch" ? "Гілки" : phase === "bud" ? "Бутони" : "Листя"} залишаться такими назавжди
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              Використати {careUnit(need)} {CARE_OF[need]}? Після посадки змінити скіни
              чи переставити елементи вже не можна.
            </p>
            <div className="row-between panel" style={{ padding: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>{CARE_NAME[need]} у запасі</span>
              <span style={{ fontWeight: 800 }}>{supplyLeft} → {Math.max(0, supplyLeft - 1)}</span>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setSheet("edit")}>Ще ні</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || supplyLeft < 1} onClick={commit}>
                {busy ? "Саджаємо…" : "Посадити"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
