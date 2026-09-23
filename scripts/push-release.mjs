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
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Відносний шлях, як у решти scripts/: робота kiosk-release у CI не робить
// bun install, а r2.js не тягне нічого, крім node:crypto.
import { put } from "../backend/lib/src/r2.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(ROOT, process.argv[2] || "dist");

// Імʼя релізу й хеш джерел рахуються з HEAD, тож незакомічена правка
// поїхала б на точки під чужим номером, і знайти потім, що там насправді
// крутиться, було б нічим. Локально (act, ручний запуск) це реальний
// сценарій; у CI дерево завжди чисте, тож перевірка нічого не коштує.
const dirty = spawnSync("git", ["status", "--porcelain", "--", "raspberry/"], { cwd: ROOT, encoding: "utf8" });
if (dirty.status === 0 && dirty.stdout.trim() && !process.env.ALLOW_DIRTY_RELEASE) {
  console.error("✗ у raspberry/ є незакомічені зміни — реліз назветься чужим комітом:");
  for (const line of dirty.stdout.trim().split("\n").slice(0, 10)) console.error("  " + line);
  console.error("  закоміть їх або постав ALLOW_DIRTY_RELEASE=1, якщо точно знаєш, що робиш");
  process.exit(1);
}

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
