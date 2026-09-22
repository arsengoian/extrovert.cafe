// import-ui-assets.mjs — картинки попапа бонусу з ассетів застосунку гравця
// в ассети кіоска, вже під розмір показу.
//
//   bun raspberry/kiosk/tools/import-ui-assets.mjs
//
// Джерело — frontend/client/public/assets/ui/: ті самі файли, на які
// посилається макет design/monitor-menu/Monitor Menu SVG.dc.html (монета й
// кавенятко там — ігрові, спільні з застосунком). Обидві теки під git, тож
// правило «генератор із design/ не пише в code/» (CLAUDE.md) тут не діє.
//
// Навіщо зменшувати заздалегідь: оригінал кавенятка — 1024² і 1,5 МБ, а в
// попапі він 396². Декодувати й масштабувати його librsvg на Pi 1 довелося б
// щоразу, коли будується попап, — це сотні мілісекунд завмерлого екрана.
// Тут це робиться один раз на ПК.

import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../../frontend/client/public/assets/ui");
const out = join(here, "../assets/ui");

// Розмір показу — templates/popup.svg (<image width="396" height="396">).
const HERO_PX = 396;

await mkdir(out, { recursive: true });

// Монета маленька (108×114) і показується в кількох розмірах (16..56 px),
// тож їде як є: librsvg зменшує її дешево.
await copyFile(join(src, "coin_gold.png"), join(out, "coin_gold.png"));

await sharp(join(src, "hero_bush.png"))
  .resize(HERO_PX, HERO_PX, { kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toFile(join(out, "hero_bush.png"));

console.log(`ui-ассети → ${out}: coin_gold.png, hero_bush.png (${HERO_PX}²)`);
