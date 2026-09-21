// Малювання сцени: список інстансів → шари <img> у координатах сцени.
// Порядок — суто z (стабільне сортування лишає однакові z у порядку
// посадки), тіні й підфарбовування настрою — як у рушії дизайну.
import { FILTER_KEY, STAGE_H, STAGE_W } from "./geometry.js";

const DEFAULT_SHADOW = { enabled: true, offsetX: 6, offsetY: 6, blur: 6, opacity: 0.8 };
const DEFAULT_FACE_SHADOW = { enabled: true, offset: 5, blur: 0.8, opacity: 0.41 };
const W0 = 220;

const isLeaf = (g) => /leaf|leav/i.test(g || "");
const isBranch = (g) => /branch/i.test(g || "");
const isFruit = (g) => /^fruit_/.test(g || "");
const isFace = (g) => /^face_setA/.test(g || "");
const isGroundShadow = (g) => g === "ground_shadow";

const filterCss = (cfg) => {
  if (!cfg) return "";
  const sat = Number(cfg.saturate), bri = Number(cfg.brightness);
  return sat === 100 && bri === 100 ? "" : `saturate(${sat}%) brightness(${bri / 100})`;
};

export function Scene({ instances, layout, mood = "healthy", camera, style, children }) {
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

        return (
          <img
            key={`l${n}`}
            src={`/assets/sprites/${inst.group}/${inst.sprite}`}
            alt=""
            style={{
              position: "absolute", left: inst.x, top: inst.y, width: w, height: "auto",
              transform: `translate(-50%,-50%) rotate(${inst.rotation ?? 0}deg)`,
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
