// Кладе в public/ те, чим кіоск малює панель акції: сам шаблон, шрифти й
// картинки напоїв. Копія, а не дубль у git: прев'ю в адмінці має показувати
// рівно те, що побачить екран точки, а для цього мусить брати ТІ САМІ файли.
//
// Чому копіюємо, а не тримаємо другий набір: два набори розійдуться на
// першій же правці шаблона, і прев'ю почне брехати — а брехливе прев'ю
// гірше за жодне, бо на нього покладаються. Тека public/assets/kiosk/ під
// .gitignore саме тому: її вміст не редагують, її перегенеровують.
//
// Запускається перед `vite dev` і перед `vite build` (package.json).
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kiosk = resolve(here, "../../../raspberry/kiosk/assets");
const out = resolve(here, "../public/assets/kiosk");

// Шрифти беремо не всі, що є в кіоска, а рівно ті, які називає ad.svg.
const FONTS = ["Extro400.ttf", "Extro700.ttf", "Extro1000.ttf"];

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/fonts`, { recursive: true });
await mkdir(`${out}/templates`, { recursive: true });

for (const f of FONTS) await cp(`${kiosk}/fonts/${f}`, `${out}/fonts/${f}`);
await cp(`${kiosk}/templates/ad.svg`, `${out}/templates/ad.svg`);
await cp(`${kiosk}/drinks-ad`, `${out}/drinks-ad`, { recursive: true });

console.log(`kiosk-assets: ${FONTS.length} шрифти, ad.svg і картинки напоїв → public/assets/kiosk/`);
