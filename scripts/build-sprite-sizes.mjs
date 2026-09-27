// Готує frontend/client/public/assets/sprites/sizes.json — природний розмір
// кожного спрайта куща: { "група/файл.png": [ширина, висота] }.
//
//   bun run sprites:sizes      # після того, як додали чи замінили спрайти
//
// Навіщо. Сцена (plant/Scene.jsx) задає спрайту ширину, а центрує його
// зсувом на −50% ВЛАСНОЇ висоти. Поки картинка не завантажилась, висота
// нульова: листок стоїть нижче свого місця, а щойно доїде — підскакує на
// пів свого розміру. Сорок листків — сорок підскоків, поки кущ
// промальовується (власник, 27.09.2026). З розміром наперед висота відома
// до завантаження, і кожен спрайт з'являється одразу там, де має бути.
//
// Розмір беремо із заголовка PNG (IHDR, байти 16–23), сам файл не
// розпаковуємо: це 83 спрайти, і скрипт має бути миттєвим.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "frontend", "client", "public", "assets", "sprites");
const OUT = path.join(DIR, "sizes.json");

const sizes = {};
for (const group of readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  for (const file of readdirSync(path.join(DIR, group)).filter((f) => f.endsWith(".png")).sort()) {
    const head = readFileSync(path.join(DIR, group, file)).subarray(0, 24);
    if (head.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${group}/${file}: не PNG`);
    sizes[`${group}/${file}`] = [head.readUInt32BE(16), head.readUInt32BE(20)];
  }
}
// Рядок на спрайт — так диф після заміни картинок читається з першого погляду.
const lines = Object.entries(sizes).map(([k, [w, h]]) => `  ${JSON.stringify(k)}: [${w}, ${h}]`);
writeFileSync(OUT, `{\n${lines.join(",\n")}\n}\n`);
console.log(`sizes.json: ${Object.keys(sizes).length} спрайтів`);
