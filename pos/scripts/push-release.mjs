// Заливає реліз малини в R2 під releases/pi/.
//   node scripts/push-release.mjs                     → з ../dist/manifest.json
//   node scripts/push-release.mjs ../dist             → інша тека
//
// Порядок навмисно жорсткий: спершу архів, маніфест ОСТАННІМ. Навпаки —
// і точка прочитає маніфест, піде по архів, якого ще немає, а після трьох
// таких кіл занесе реліз у bad-releases назавжди (docs/raspberry-pi.md §3).
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, put } from "./lib/r2.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", process.argv[2] || "../dist");
const manifest = JSON.parse(readFileSync(`${dist}/manifest.json`, "utf8"));
const { release, sha256, size } = manifest;
if (!release || !sha256) { console.error("✗ маніфест без release/sha256"); process.exit(1); }

const tar = `${dist}/${release}.tar.gz`;
const body = readFileSync(tar);
// Звіряємо тут, а не після заливки: обірваний scp з малини дешевше зловити
// на ПК, ніж на точці — там це три невдалі кола й реліз у bad-releases.
const real = createHash("sha256").update(body).digest("hex");
if (real !== sha256 || body.length !== size) {
  console.error(`✗ ${release}.tar.gz не збігається з маніфестом`);
  console.error(`  sha256: ${real}\n  розмір: ${body.length} проти ${size}`);
  process.exit(1);
}
if (!manifest.url.endsWith(`/releases/pi/${release}.tar.gz`)) {
  console.error(`✗ url у маніфесті веде не туди: ${manifest.url}`); process.exit(1);
}

const env = loadEnv();
try {
  // Архів незмінний — імʼя містить версію, перезаливати нічого. Маніфест
  // навпаки: must-revalidate, щоб CDN щоразу звірявся з бакетом по ETag.
  // Апдейтер і так шле If-None-Match, тож коштує це 304, а не трафік; зате
  // новий реліз не чекає, поки десь протухне копія.
  console.log(`→ ${release}.tar.gz (${Math.round(body.length / 1024)} КБ)`);
  await put(env, {
    key: `releases/pi/${release}.tar.gz`, body,
    contentType: "application/gzip",
    cacheControl: "public, max-age=31536000, immutable"
  });
  console.log("→ manifest.json");
  await put(env, {
    key: "releases/pi/manifest.json", body: readFileSync(`${dist}/manifest.json`),
    contentType: "application/json",
    cacheControl: "public, max-age=0, must-revalidate"
  });
  console.log(`✓ реліз ${release} у R2; точка підхопить протягом 15 хв`);
} catch (e) {
  console.error("✗", e.message);
  console.error("  якщо впав архів — маніфеста в бакеті ще немає, точка нічого не побачила");
  process.exit(1);
}
