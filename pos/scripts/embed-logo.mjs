// Вставити лого у public/index.html між маркерами <!-- logo:start --> і <!-- logo:end -->.
//
// Лого генерується в design/ (див. design/logo/README.md), але ЖИВЕ воно тут:
// index.html — джерело істини для кіоска, і жоден генератор його не переписує.
// Цей скрипт — єдиний спосіб оновити лого, і він міняє рівно один рядок.
//
//   node scripts/embed-logo.mjs ../../design/logo/versions/B/logo.svg
//   node scripts/embed-logo.mjs ../../design/logo/versions/A/logo.svg
//
// Що робиться з файлом лого:
//   · знімається чорна підкладка — у кіоска свій фон;
//   · #FFFFFF → #F2EFE6, бо світла тема перемикає колір саме цим правилом
//     (style.css: body.light #logo path[fill="#F2EFE6"]);
//   · додається id="logo", прибираються width/height — розмір задає CSS.
//
// ⚠️ Пропорції. Версія Б — 997×200, стара версія була 560×150. Якщо міняєш
// версію, підправ і #logo{width;height} у style.css, інакше лого або
// розтягнеться, або лишить порожнечу.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error("вкажи шлях до logo.svg, напр. ../../design/logo/versions/B/logo.svg");
  process.exit(1);
}
const svgPath = path.resolve(here, src);
const htmlPath = path.join(here, "..", "public", "index.html");

let svg = fs.readFileSync(svgPath, "utf8").trim();
const before = svg.length;
svg = svg.replace(/<rect[^>]*fill="#000(?:000)?"[^>]*\/>/g, "");
svg = svg.replace(/#FFFFFF/g, "#F2EFE6").replace(/#ffffff/g, "#F2EFE6");
svg = svg.replace(/<svg /, '<svg id="logo" ');
svg = svg.replace(/\s(?:width|height)="\d+"/g, "");

const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || "?";
const html = fs.readFileSync(htmlPath, "utf8");
const re = /(<!-- logo:start -->)[\s\S]*?(<!-- logo:end -->)/;
if (!re.test(html)) {
  console.error("у index.html немає маркерів <!-- logo:start --> / <!-- logo:end -->");
  process.exit(1);
}
fs.writeFileSync(htmlPath, html.replace(re, "$1" + svg + "$2"));

console.log("лого: " + path.relative(process.cwd(), svgPath));
console.log("viewBox " + vb + " · " + before + " → " + svg.length + " символів");
console.log("не забудь звірити #logo{width;height} у style.css з пропорціями viewBox");
