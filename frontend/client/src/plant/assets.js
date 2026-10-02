// Файли даних, без яких кавенятка не намалювати: еталонний макет,
// зони/криві посадки, метадані спрайтів (корінь + природний кут),
// природні розміри всіх спрайтів (sizes.json, bun run sprites:sizes),
// обличчя B–E й одяг (обидва — частина layout).
// Вантажаться один раз на сесію — далі всі екрани беруть із кешу.
import { useEffect, useState } from "react";

let cache = null;
let pending = null;

async function load() {
  const [layout, placement, sprites, sizes, faces, clothes] = await Promise.all([
    fetch("/assets/tree_layout.json").then((r) => r.json()),
    fetch("/assets/planting/placement.json").then((r) => r.json()),
    fetch("/assets/planting/sprites.json").then((r) => r.json()),
    // Без розмірів сцена все одно малюється — лише зі старим підскоком.
    fetch("/assets/sprites/sizes.json").then((r) => r.json()).catch(() => ({})),
    // Обличчя наборів B–E (scene.js, faceInstances). Без файла кожне
    // кавенятко малюється з обличчям A — як до 02.10.2026, а не без обличчя.
    fetch("/assets/face_sets_layout.json").then((r) => r.json()).catch(() => ({})),
    // Одяг усіх наборів (scene.js, wornInstances). Без файла кавенятко
    // малюється без одягу — краще, ніж не намалюватись зовсім.
    fetch("/assets/clothes_layout.json").then((r) => r.json()).catch(() => ({})),
  ]);
  // Обличчя — частина макета: усі, хто складає сцену (головний екран,
  // мініатюри, посадка, друк), уже передають layout, тож нових параметрів
  // їм не треба — лише face_set_id кавенятка.
  cache = { layout: { ...layout, faceSets: faces.sets ?? {}, clothes }, placement, sprites: sprites.sprites, sizes };
  return cache;
}

export function loadPlantAssets() {
  if (cache) return Promise.resolve(cache);
  pending ??= load().finally(() => { pending = null; });
  return pending;
}

export function usePlantAssets() {
  const [assets, setAssets] = useState(cache);
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    loadPlantAssets().then((a) => { if (alive) setAssets(a); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return assets;
}

export const spriteMeta = (assets, group, sprite) => assets.sprites[`${group}:${sprite}`];
