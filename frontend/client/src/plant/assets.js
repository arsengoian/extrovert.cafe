// Файли даних, без яких кавенятка не намалювати: еталонний макет,
// зони/криві посадки, метадані спрайтів (корінь + природний кут) і
// природні розміри всіх спрайтів (sizes.json, bun run sprites:sizes).
// Вантажаться один раз на сесію — далі всі екрани беруть із кешу.
import { useEffect, useState } from "react";

let cache = null;
let pending = null;

async function load() {
  const [layout, placement, sprites, sizes] = await Promise.all([
    fetch("/assets/tree_layout.json").then((r) => r.json()),
    fetch("/assets/planting/placement.json").then((r) => r.json()),
    fetch("/assets/planting/sprites.json").then((r) => r.json()),
    // Без розмірів сцена все одно малюється — лише зі старим підскоком.
    fetch("/assets/sprites/sizes.json").then((r) => r.json()).catch(() => ({})),
  ]);
  cache = { layout, placement, sprites: sprites.sprites, sizes };
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
