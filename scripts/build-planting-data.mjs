// Готує client/public/assets/planting/sprites.json — по спрайту:
// корінь посадки (Крок 1 конвеєра), природний розмір і «природний кут».
//
// Природний кут — напрямок від кореня до найдальшого непрозорого пікселя
// (той самий computeDirVector, що й у design/sprites/tools/planting_points_editor.html).
// Клієнт мусить знати його, щоб порахувати item.rotation: кут, під яким
// спрайт реально «дивиться», відрізняється від нуля, і без цієї поправки
// листок на нормалі лежав би боком (docs/bush_planting_ui.md §2).
//
// Рахуємо один раз тут, а не в браузері: інакше застосунок на старті тягнув
// би 14 PNG у canvas і робив те саме на кожному пристрої.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "client", "public", "assets");
const OUT = path.join(ASSETS, "planting", "sprites.json");

// Найдальший видимий піксель від кореня — саме так «напрямок спрайту»
// визначає редактор зон, і саме з ним каліброві всі кути в placement.json.
function dirVector({ width, height, data }, root) {
  const step = width > 300 ? 3 : 2;
  let best = -1, bx = root.x, by = root.y;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue;
      const d = (x - root.x) ** 2 + (y - root.y) ** 2;
      if (d > best) { best = d; bx = x; by = y; }
    }
  }
  const dx = bx - root.x, dy = by - root.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, dist: len };
}

const points = JSON.parse(readFileSync(path.join(ASSETS, "planting", "points.json"), "utf8")).points;
const sprites = {};

for (const [key, p] of Object.entries(points)) {
  const file = path.join(ASSETS, "sprites", p.group, p.sprite);
  const mask = PNG.sync.read(readFileSync(file));
  const root = { x: p.x, y: p.y };
  const dir = dirVector(mask, root);
  sprites[key] = {
    root,
    natural: [mask.width, mask.height],
    angle: Number(((Math.atan2(dir.dy, dir.dx) * 180) / Math.PI).toFixed(2)),
  };
}

writeFileSync(OUT, `${JSON.stringify({
  $comment: "Згенеровано scripts/build-planting-data.mjs із points.json і самих спрайтів. Руками не редагувати.",
  generated: new Date().toISOString().slice(0, 10),
  sprites,
}, null, 1)}\n`);

console.log(`${OUT}: ${Object.keys(sprites).length} спрайтів`);
