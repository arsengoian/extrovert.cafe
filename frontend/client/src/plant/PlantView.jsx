// Кавенятко у відведеному прямокутнику: збирає сцену й підганяє камеру так,
// щоб кущ цілком уліз у кадр — на стадії 0 це паросток завбільшки з палець,
// на стадії 10 крона на всю ширину, і жодних магічних множників у місці
// виклику.
import { fitCamera, STAGE_H, STAGE_W, W0 } from "./geometry.js";
import { buildScene } from "./scene.js";
import { Scene } from "./Scene.jsx";
import { usePlantAssets } from "./assets.js";

// fit="stage" — уся сцена 1000×1300, вписана в прямокутник, а не кадр по
// кущу: так мініатюри в «Кому вдягнути» показують кавенят у масштабі.
export function PlantView({ plant, appearance, stage, mood, worn, width = 250, height, platform = true, pad = 18, fit = "bush" }) {
  const assets = usePlantAssets();
  const h = height ?? width * 1.15;
  if (!assets) return <div style={{ width, height: h, margin: "0 auto" }} />;

  const s = stage ?? plant?.growth_stage ?? 0;
  const m = mood ?? plant?.mood ?? "healthy";
  let instances = buildScene({
    layout: assets.layout,
    appearance: appearance ?? plant?.appearance,
    stage: s,
    mood: m,
    worn,
  });
  if (!platform) instances = instances.filter((i) => i.group !== "platform" && i.group !== "ground_shadow");

  const points = [];
  for (const i of instances) {
    if (!i.sprite) continue;
    const r = (W0 * i.scale) / 2;
    points.push({ x: i.x - r, y: i.y - r }, { x: i.x + r, y: i.y + r });
  }
  const k = Math.min(width / STAGE_W, h / STAGE_H);
  const camera = fit === "stage"
    ? { k, tx: width / 2 - (STAGE_W / 2) * k, ty: h / 2 - (STAGE_H / 2) * k }
    : fitCamera(points, { x: 0, y: 0, w: width, h }, pad);

  return (
    <div style={{ position: "relative", width, height: h, margin: "0 auto" }}>
      <Scene instances={instances} layout={assets.layout} mood={m} camera={camera} />
    </div>
  );
}
