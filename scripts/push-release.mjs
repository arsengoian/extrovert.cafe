// Заливає реліз кіоска в R2 під releases/pi/.
//
//   bun scripts/push-release.mjs            → з ./dist/manifest.json
//   bun scripts/push-release.mjs ./dist     → інша тека
//
// Звичайний шлях — GitHub Actions: збірка під armv6, пакування й заливка
// йдуть одним кроком (.github/workflows/deploy.yml, робота `kiosk-release`).
// Руками це запускають лише тоді, коли треба викотити реліз повз CI.
//
// Порядок навмисно жорсткий: спершу архів, маніфест ОСТАННІМ. Навпаки —
// і точка прочитає маніфест, піде по архів, якого ще немає, а після трьох
// таких кіл занесе реліз у bad-releases назавжди (docs/raspberry-pi.md §3).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@extrovert/lib/r2.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(ROOT, process.argv[2] || "dist");

const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
const { release, sha256, size } = manifest;
if (!release || !sha256) { console.error("✗ маніфест без release/sha256"); process.exit(1); }

const body = readFileSync(path.join(dist, `${release}.tar.gz`));
// Звіряємо тут, а не після заливки: обірваний файл дешевше зловити зараз,
// ніж на точці — там це три невдалі кола й реліз у bad-releases.
const real = createHash("sha256").update(body).digest("hex");
if (real !== sha256 || body.length !== size) {
  console.error(`✗ ${release}.tar.gz не збігається з маніфестом`);
  console.error(`  sha256: ${real}\n  розмір: ${body.length} проти ${size}`);
  process.exit(1);
}
if (!manifest.url.endsWith(`/releases/pi/${release}.tar.gz`)) {
  console.error(`✗ url у маніфесті веде не туди: ${manifest.url}`);
  process.exit(1);
}

try {
  // Архів незмінний — імʼя містить версію, перезаливати нічого. Маніфест
  // навпаки: must-revalidate, щоб CDN щоразу звірявся з бакетом по ETag.
  // Апдейтер і так шле If-None-Match, тож коштує це 304, а не трафік; зате
  // новий реліз не чекає, поки десь протухне копія.
  console.log(`→ ${release}.tar.gz (${Math.round(body.length / 1024)} КБ)`);
  await put({
    purpose: "pos",
    key: `releases/pi/${release}.tar.gz`,
    body,
    contentType: "application/gzip",
    cacheControl: "public, max-age=31536000, immutable",
  });
  console.log("→ manifest.json");
  await put({
    purpose: "pos",
    key: "releases/pi/manifest.json",
    body: readFileSync(path.join(dist, "manifest.json")),
    contentType: "application/json",
    cacheControl: "public, max-age=0, must-revalidate",
  });
  console.log(`✓ реліз ${release} у R2; точка підхопить протягом 15 хв`);
} catch (e) {
  console.error("✗", e.message);
  console.error("  якщо впав архів — маніфеста в бакеті ще немає, точка нічого не побачила");
  process.exit(1);
}
