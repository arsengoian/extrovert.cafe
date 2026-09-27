// Малювання сцени: список інстансів → шари <img> у координатах сцени.
// Порядок — суто z (стабільне сортування лишає однакові z у порядку
// посадки), тіні й підфарбовування настрою — як у рушії дизайну.
import { useEffect, useRef, useState } from "react";
import { FILTER_KEY, STAGE_H, STAGE_W } from "./geometry.js";
import { usePlantAssets } from "./assets.js";

const DEFAULT_SHADOW = { enabled: true, offsetX: 6, offsetY: 6, blur: 6, opacity: 0.8 };
const DEFAULT_FACE_SHADOW = { enabled: true, offset: 5, blur: 0.8, opacity: 0.41 };
const W0 = 220;

const isLeaf = (g) => /leaf|leav/i.test(g || "");
const isBranch = (g) => /branch/i.test(g || "");
const isFruit = (g) => /^fruit_/.test(g || "");
const isFace = (g) => /^face_setA/.test(g || "");
const isGroundShadow = (g) => g === "ground_shadow";
// Погойдування (bush_graphics_customization §10.16): листя, гілки й крона
// з обличчям — кожне своїм ритмом; саму анімацію вмикає data-idle сцени.
const swayOf = (g) => (isLeaf(g) ? "leaf" : isBranch(g) ? "branch" : isFace(g) || /body_stage/.test(g || "") ? "crown" : undefined);

// Метадані спрайта (корінь + природний розмір) лежать лише для базового
// варіанта, а сцена малює й сумний/зів'ялий — геометрія в них та сама,
// різниться колір. Тому суфікс настрою знімаємо перед пошуком:
// leaves_batch_sad:leaf_skin1_sad.png → leaves_batch_normal:leaf_skin1_normal.png,
// branch_skins_custom_withered:…_withered.png → branch_skins_custom:….png.
function metaOf(sprites, group, sprite) {
  if (!sprites || !group || !sprite) return null;
  const g = group.replace(/_(very_sad|sad|withered)$/, "");
  const f = sprite.replace(/_(very_sad|sad|withered)\.png$/, ".png");
  const gk = g === "leaves_batch" ? "leaves_batch_normal" : g;
  const fk = /^leaf_skin\d+\.png$/.test(f) ? f.replace(".png", "_normal.png") : f;
  return sprites[`${group}:${sprite}`] ?? sprites[`${gk}:${fk}`] ?? null;
}

// Гойдання навколо КОРЕНЯ, а не кута (власник, 26.09.2026: «листки
// повертаються не навколо своєї точки кореня а навколо якогось кутка»).
//
// Раніше погойдування робила властивість `rotate`, а вона обертає навколо
// transform-origin — центру коробки спрайта ДО зсуву translate(-50%,-50%).
// Після зсуву ця точка стоїть у правому нижньому куті намальованого листка:
// кожен листок гойдався навколо кута, а його центр ходив туди-сюди на 1,9 px
// (заміряно). Двадцять листків у різних фазах — «усе повзе в різні боки».
//
// Тепер гойдання — кут --sway усередині ланцюжка трансформацій:
// translate(корінь) rotate(гойдання) translate(−корінь), де корінь — точка
// кріплення в локальних координатах спрайта (з метаданих). Статичний
// поворот і розстановка не змінюються: без гойдання --sway = 0.
// Немає метаданих (крона, обличчя) — обертання навколо власного центру.
function pivotOf(meta, w) {
  if (!meta?.root || !meta?.natural) return [0, 0];
  const [nw, nh] = meta.natural;
  const F = w / nw;
  return [meta.root.x * F - w / 2, meta.root.y * F - (nh * F) / 2];
}

const filterCss = (cfg) => {
  if (!cfg) return "";
  const sat = Number(cfg.saturate), bri = Number(cfg.brightness);
  return sat === 100 && bri === 100 ? "" : `saturate(${sat}%) brightness(${bri / 100})`;
};

export function Scene({ instances, layout, mood = "healthy", camera, idle, style, children }) {
  const assets = usePlantAssets();
  // «Поза екраном анімація ставиться на паузу» (дошка «Анімації»): гойдання
  // вмикається, лише поки сцену видно.
  const root = useRef(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    if (!idle || !root.current || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting));
    io.observe(root.current);
    return () => io.disconnect();
  }, [idle]);

  const filters = layout?.colorFilters ?? {};
  const shadow = { ...DEFAULT_SHADOW, ...(layout?.shadow ?? {}) };
  const faceShadow = { ...DEFAULT_FACE_SHADOW, ...(layout?.faceShadow ?? {}) };
  const key = FILTER_KEY[mood];
  const moodFilter = key ? filterCss(filters[key]) : "";
  const fruitFilter = key ? filterCss(filters[`fruit_${key}`]) : "";
  const dropShadow = shadow.enabled
    ? `drop-shadow(${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px rgba(15,12,4,${shadow.opacity}))`
    : "";

  return (
    <div
      ref={root}
      data-idle={(idle && seen) || undefined}
      style={{
        position: "absolute", left: 0, top: 0, width: STAGE_W, height: STAGE_H,
        transformOrigin: "0 0",
        transform: camera ? `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.k})` : undefined,
        pointerEvents: "none",
        ...style,
      }}
    >
      {instances.map((inst, n) => {
        const w = W0 * inst.scale;
        if (isGroundShadow(inst.group)) {
          return (
            <div
              key={`g${n}`}
              style={{
                position: "absolute", left: inst.x, top: inst.y, width: w, height: w * 0.35,
                borderRadius: "50%", zIndex: inst.z,
                background: `radial-gradient(closest-side, rgba(${inst.color ?? "90,90,90"},${inst.opacity ?? 0.4}) 65%, rgba(${inst.color ?? "90,90,90"},0) 100%)`,
                filter: `blur(${inst.blur ?? 8}px)`,
                transform: `translate(-50%,-50%) rotate(${inst.rotation ?? 0}deg)`,
              }}
            />
          );
        }

        const parts = [];
        const tint = isFruit(inst.group) ? fruitFilter : moodFilter;
        if (tint) parts.push(tint);
        if ((isLeaf(inst.group) || isBranch(inst.group) || isFruit(inst.group)) && dropShadow) parts.push(dropShadow);
        if (isFace(inst.group) && faceShadow.enabled) {
          const sp = (inst.sprite || "").toLowerCase();
          // Брови кидають тінь вниз, решта деталей обличчя — вгору.
          const side = sp.includes("_brow") ? 1 : /_eye|_pupil|_mouth/.test(sp) ? -1 : 0;
          if (side) parts.push(`drop-shadow(0px ${side * faceShadow.offset}px ${faceShadow.blur}px rgba(8,28,10,${faceShadow.opacity}))`);
        }

        const sway = swayOf(inst.group);
        const [px, py] = sway ? pivotOf(metaOf(assets?.sprites, inst.group, inst.sprite), w) : [0, 0];
        // Висота — наперед, із природного розміру (sizes.json). Спрайт
        // центрується зсувом на −50% власної висоти, і з height: auto до
        // завантаження вона нульова: листок стояв нижче свого місця й
        // підскакував, щойно картинка доїжджала — кущ «стрибав», поки
        // промальовувався (власник, 27.09.2026). Розміру немає (новий
        // спрайт, маніфест не оновили) — ховаємо картинку до завантаження:
        // краще з'явитись із запізненням, ніж підстрибнути.
        const size = assets?.sizes?.[`${inst.group}/${inst.sprite}`];
        return (
          <img
            key={`l${n}`}
            src={`/assets/sprites/${inst.group}/${inst.sprite}`}
            alt=""
            data-sway={sway}
            data-pop={inst.pop || undefined}
            onLoad={size ? undefined : (e) => { e.currentTarget.style.visibility = "visible"; }}
            style={{
              position: "absolute", left: inst.x, top: inst.y, width: w, height: size ? (w * size[1]) / size[0] : "auto",
              visibility: size ? undefined : "hidden",
              transform: sway
                ? `translate(-50%,-50%) rotate(${inst.rotation ?? 0}deg) translate(${px}px, ${py}px) rotate(var(--sway, 0deg)) translate(${-px}px, ${-py}px)`
                : `translate(-50%,-50%) rotate(${inst.rotation ?? 0}deg)`,
              zIndex: inst.z, filter: parts.join(" ") || "none",
              opacity: inst.opacity ?? 1,
            }}
          />
        );
      })}
      {children}
    </div>
  );
}
