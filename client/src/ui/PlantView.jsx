// Кавенятко складається зі спрайтів шарами, а не одною картинкою
// (bush_graphics_customization.md §0): тіло, обличчя, листя, гілки, плоди.
// Координати x/y — частки від сцени, як у JSON стану рослини (§9).
const S = "/assets/sprites";

// Набір облич поки один — A; face_set_id з бази ляже сюди, коли домалюють
// решту (у схемі це звичайний int саме тому).
const faceDir = (mood) =>
  mood === "withered" ? "face_setA_very_sad" : mood === "sad" ? "face_setA_sad" : "face_setA_normal";
const facePrefix = (mood) =>
  mood === "withered" ? "face_A_very_sad" : mood === "sad" ? "face_A_sad" : "face_A_normal";

const leafDir = (mood) =>
  mood === "withered" ? "leaves_batch_very_sad" : mood === "sad" ? "leaves_batch_sad" : "leaves_batch_normal";
const leafFile = (spriteId, mood) => {
  const n = String(spriteId).match(/\d+/)?.[0] ?? "1";
  const suffix = mood === "withered" ? "very_sad" : mood === "sad" ? "sad" : "normal";
  return `leaf_skin${n}_${suffix}.png`;
};

const branchDir = (mood) =>
  mood === "withered" ? "branch_skins_custom_withered" : mood === "sad" ? "branch_skins_custom_sad" : "branch_skins_custom";
const branchFile = (spriteId, mood) => {
  const n = String(spriteId).match(/\d+/)?.[0] ?? "1";
  const suffix = mood === "withered" ? "_withered" : mood === "sad" ? "_sad" : "";
  return `branch_custom_skin${n}${suffix}.png`;
};

const fruitFile = (state) =>
  state === "flower" ? "fruit_bud_greenbean/fruit_bud.png"
  : state === "green" ? "fruit_bud_greenbean/fruit_green_bean.png"
  : "fruit_bud_greenbean/fruit_bud.png";

const at = (x, y, w) => ({
  position: "absolute",
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: w,
  transform: "translate(-50%, -50%)",
});

export function PlantView({ plant, size = 260 }) {
  const a = plant?.appearance ?? {};
  const mood = plant?.mood ?? "healthy";
  const stage = plant?.growth_stage ?? 0;
  const sprout = stage === 0;

  return (
    <div style={{ position: "relative", width: size, height: size * 1.15, margin: "0 auto" }}>
      {/* тіло */}
      <img
        src={sprout ? `${S}/body_stage0_sprout/body_stage0_sprout.png` : `${S}/body_stage1_sphere/body_stage1_with_face_slot.png`}
        alt=""
        style={{ ...at(0.5, 0.62, size * 0.72), zIndex: 2 }}
      />

      {/* гілки — під листям, щоб листя лягало зверху */}
      {!sprout && (a.branches ?? []).map((b) => (
        <img key={b.branch_id} src={`${S}/${branchDir(mood)}/${branchFile(b.sprite_id, mood)}`} alt=""
             style={{ ...at(b.x, b.y, size * 0.34), zIndex: 1 }} />
      ))}

      {/* листя */}
      {!sprout && (a.leaves ?? []).map((l) => (
        <img key={l.leaf_id} src={`${S}/${leafDir(mood)}/${leafFile(l.sprite_id, mood)}`} alt=""
             style={{ ...at(l.x, l.y, size * 0.3), zIndex: 3 }} />
      ))}

      {/* плоди */}
      {!sprout && (a.fruits ?? []).map((f) => (
        <img key={f.fruit_id} src={`${S}/${fruitFile(f.state)}`} alt=""
             style={{ ...at(f.x, f.y, size * 0.14), zIndex: 4 }} />
      ))}

      {/* обличчя: очі, зіниці, брови, рот — окремими деталями (§10.2) */}
      {!sprout && (
        <div style={{ ...at(0.5, 0.6, size * 0.46), zIndex: 5, aspectRatio: "1 / 1" }}>
          {["eye_L", "eye_R", "pupil_L", "pupil_R", "brow_L", "brow_R", "mouth"].map((part) => (
            <img key={part} src={`${S}/${faceDir(mood)}/${facePrefix(mood)}_${part}.png`} alt=""
                 style={{ position: "absolute", inset: 0, width: "100%" }} />
          ))}
        </div>
      )}
    </div>
  );
}
