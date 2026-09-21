// Кавенятко у відведеному прямокутнику: збирає сцену й підганяє камеру так,
// щоб кущ цілком уліз у кадр — на стадії 0 це паросток завбільшки з палець,
// на стадії 10 крона на всю ширину, і жодних магічних множників у місці
// виклику.
import { fitCamera, W0 } from "./geometry.js";
import { buildScene } from "./scene.js";
import { Scene } from "./Scene.jsx";
import { usePlantAssets } from "./assets.js";

export function PlantView({ plant, appearance, stage, mood, worn, width = 250, height, platform = true, pad = 18 }) {
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
  const camera = fitCamera(points, { x: 0, y: 0, w: width, h }, pad);

  return (
    <div style={{ position: "relative", width, height: h, margin: "0 auto" }}>
      <Scene instances={instances} layout={assets.layout} mood={m} camera={camera} />
    </div>
  );
}
