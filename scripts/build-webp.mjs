// WebP-копії всіх PNG застосунку гравця — у кількох роздільностях.
//
//   bun run images:webp          # після того, як додали чи замінили картинку
//   bun run images:webp:check    # CI: чи всі копії на місці й свіжі
//
// Навіщо (власник, 02.10.2026). Спрайти й картинки лежали PNG у повній
// роздільності: головний екран — до 4 МБ при першому відкритті, тіло
// кавенятка — 619 КБ при 1024 px, хоча на екрані воно ≈140 px. WebP з
// альфою важить у 6–8 разів менше, а зменшені копії дають браузеру взяти
// рівно ту, якої вистачає екрану: srcset із шириною, sizes — розмір на
// екрані, і браузер сам множить його на щільність пікселів (на iPhone ×3).
// Тому менша копія ніколи не потрапить туди, де її бракує, — навіть на
// найщільнішому екрані браузер візьме більшу або оригінал.
//
// Що пишемо поруч із x.png:
//   x.webp        — повна роздільність;
//   x-<w>w.webp   — ширина w із драбинки WIDTHS, лише менші за оригінал.
// І frontend/client/src/images.gen.json — { "ui/x.png": [256, 512, 1024] }:
// які ширини є в кожної картинки (остання — оригінал). Його імпортує бандл
// (ui/img.js), тож окремого запиту по маніфест немає.
//
// PNG лишаються: з них малюється PNG для друку (без втрат), їх беруть листи
// (поштові клієнти WebP не всі вміють) і кіоск. Теку email не чіпаємо.
//
// Свіжість — за хешем PNG у frontend/client/webp.lock.json: перевірка в CI
// рахує хеші й заглядає в заголовок PNG, але нічого не кодує, тож sharp їй
// не потрібен. Застаріла чи забута копія — код 1 і підказка, що запустити.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "frontend", "client", "public", "assets");
const DIRS = ["sprites", "ui", "drinks"];
const MANIFEST = path.join(ROOT, "frontend", "client", "src", "images.gen.json");
const LOCK = path.join(ROOT, "frontend", "client", "webp.lock.json");

// Драбинка ширин. 256 — мініатюри й іконки, 512 — головний екран на
// телефоні, 1024 — зум посадки й планшети; більше — лише оригінал.
const WIDTHS = [256, 512, 1024];
// Якість 90 з альфою без втрат: на контурах спрайтів (темна обводка поверх
// прозорого) нижча якість уже дає ореол, а різниця у вазі — копійчана.
const WEBP = { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true };

const check = process.argv.includes("--check");

function pngs(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...pngs(dir, r));
    else if (entry.name.endsWith(".png")) out.push(r);
  }
  return out;
}

const widthOf = (file) => {
  const head = readFileSync(file).subarray(0, 24);
  if (head.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${file}: не PNG`);
  return head.readUInt32BE(16);
};
const hashOf = (file) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 16);
const widthsFor = (native) => [...WIDTHS.filter((w) => w < native), native];
const outName = (png, w, native) => png.replace(/\.png$/, w === native ? ".webp" : `-${w}w.webp`);

const files = DIRS.flatMap((d) => pngs(ASSETS, d)).sort();
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {};
const manifest = {};
const nextLock = {};
const stale = [];

for (const rel of files) {
  const abs = path.join(ASSETS, rel);
  const native = widthOf(abs);
  const widths = widthsFor(native);
  const hash = hashOf(abs);
  manifest[rel] = widths;
  nextLock[rel] = hash;
  const outs = widths.map((w) => path.join(ASSETS, outName(rel, w, native)));
  if (lock[rel] !== hash || outs.some((o) => !existsSync(o))) stale.push({ rel, abs, native, widths, outs });
}

// Копії, чий PNG прибрали, — теж застарілі: інакше вони жили б вічно.
const expected = new Set(Object.entries(manifest).flatMap(([rel, ws]) => ws.map((w) => outName(rel, w, ws.at(-1)))));
const orphans = DIRS.flatMap((d) => {
  const walk = (rel) => readdirSync(path.join(ASSETS, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.posix.join(rel, e.name)) : e.name.endsWith(".webp") ? [path.posix.join(rel, e.name)] : []);
  return walk(d);
}).filter((rel) => !expected.has(rel));

const manifestText = `{\n${Object.entries(manifest).map(([k, v]) => `  ${JSON.stringify(k)}: [${v.join(", ")}]`).join(",\n")}\n}\n`;

if (check) {
  const problems = [
    ...stale.map((s) => `застаріла або відсутня копія: ${s.rel}`),
    ...orphans.map((o) => `копія без PNG: ${o}`),
    ...(existsSync(MANIFEST) && readFileSync(MANIFEST, "utf8") === manifestText ? [] : ["images.gen.json не збігається з картинками"]),
  ];
  if (problems.length) {
    console.error(problems.slice(0, 20).join("\n"));
    console.error(`\n${problems.length} проблем. Запусти: bun run images:webp — і закоміть результат.`);
    process.exit(1);
  }
  console.log(`webp: ${files.length} картинок, усі копії свіжі`);
  process.exit(0);
}

const { default: sharp } = await import("sharp");
let before = 0, after = 0;
for (const s of stale) {
  for (const [i, w] of s.widths.entries()) {
    const img = sharp(s.abs);
    await (w === s.native ? img : img.resize({ width: w })).webp(WEBP).toFile(s.outs[i]);
  }
  before += statSync(s.abs).size;
  after += statSync(s.outs.at(-1)).size;
}
for (const o of orphans) unlinkSync(path.join(ASSETS, o));
writeFileSync(MANIFEST, manifestText);
writeFileSync(LOCK, `{\n${Object.entries(nextLock).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
console.log(`webp: оновлено ${stale.length} з ${files.length}, прибрано ${orphans.length}` +
  (stale.length ? ` · оригінали ${Math.round(before / 1024)} КБ → ${Math.round(after / 1024)} КБ` : ""));
