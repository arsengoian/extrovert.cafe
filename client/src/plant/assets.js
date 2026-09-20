// Три файли даних, без яких кавенятка не намалювати: еталонний макет,
// зони/криві посадки й метадані спрайтів (корінь + природний кут).
// Вантажаться один раз на сесію — далі всі екрани беруть із кешу.
import { useEffect, useState } from "react";

let cache = null;
let pending = null;

async function load() {
  const [layout, placement, sprites] = await Promise.all([
    fetch("/assets/tree_layout.json").then((r) => r.json()),
    fetch("/assets/planting/placement.json").then((r) => r.json()),
    fetch("/assets/planting/sprites.json").then((r) => r.json()),
  ]);
  cache = { layout, placement, sprites: sprites.sprites };
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
