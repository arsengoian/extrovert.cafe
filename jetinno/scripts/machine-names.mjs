// Виправити назви напоїв НА МАШИНІ до нашого стандарту (docs/jetinno.md,
// «Напої на машині»). Працює з recipe-пакетом машини, не з порталом і не з
// цінами: патчить лише назви в .product (nameLang.uk_ + nameCN), файл .recipe
// (рецептури) лишає недоторканим. Це єдиний спосіб змінити напис на машині —
// застосунок Tapo... ні, то камера; тут — портал головний напис не змінює,
// лише Upgrade Center (портал → машина).
//
//   bun jetinno/scripts/machine-names.mjs                 # суха прогонка: тягне свіжий пакет (бекап), показує різницю, збирає й перевіряє патч ЛОКАЛЬНО. Нічого не пише ні в портал, ні на машину.
//   bun jetinno/scripts/machine-names.mjs --only 15       # обмежити одним напоєм (productId) — для першого обережного тесту
//   bun jetinno/scripts/machine-names.mjs --push          # + залити патч у портал (package_save) і надіслати машині (console_upgrade), тоді звірити
//   bun jetinno/scripts/machine-names.mjs --restore <file.zip>  # відкат: залити вказаний пакет назад на машину
//
// БЕЗПЕКА: пакет, який машина щойно вивантажила, зберігається в
// jetinno/backups/<дата>/ ДО будь-якого запису — це точка відкату
// (--restore). Recipe-файл у патчі лишається байт-ідентичним. Спершуганяй без
// --push і дивись різницю; перший --push роби з --only на один напій.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { get, post, postForm, getBuffer, BASE, VMC, sendAndWatch, machineProducts, menuDrinks, die, sleep } from "./portal.mjs";
import { readZip, writeZip } from "./zip.mjs";

// Стандартні назви (productId → наша назва). Рівно ті, що розходяться з
// каталогом машини (звірено 08.10.2026). productId = drinks.slot без нуля.
const RENAMES = {
  26: "Подвійний еспресо",      // було «Подвійне еспресо»
  102: "Еспресо з молоком",     // було «Кортадо(еспресо з молоком)»
  27: "Лунго",                  // було «Кава лунго»
  17: "Флет-вайт",              // було «Флет вайт»
  15: "Мокачино",               // було «Мокачіно»
};

const args = process.argv.slice(2);
const PUSH = args.includes("--push");
const restoreIdx = args.indexOf("--restore");
const RESTORE = restoreIdx >= 0 ? args[restoreIdx + 1] : null;
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? Number(args[onlyIdx + 1]) : null;
const fromIdx = args.indexOf("--from");
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : null;   // локальний zip замість свіжого з машини (офлайн-тест патча)

const today = new Date().toISOString().slice(0, 10);
const backupDir = new URL(`../backups/${today}/`, import.meta.url);
mkdirSync(backupDir, { recursive: true });

// ── Завантажити свіжий recipe-пакет, який машина вивантажує сама ────────────
// upload recipe = машина → портал (нічого на машину не пише). Потім беремо
// найновіше посилання на Recipe_Product_Zip зі «Списку пакетів» (/packet).
async function newestRecipeLink() {
  const html = await get("/packet?perPage=80&page=1");
  const links = [...new Set([...html.matchAll(new RegExp(`/upload/app/${VMC}/[^"']*Recipe_Product_Zip[^"']*\\.zip`, "g"))].map((m) => m[0]))];
  links.sort();                            // ім'я починається з часу прийому порталом → найновіший останній
  return links[links.length - 1] || null;
}
async function fetchFreshPackage() {
  const before = await newestRecipeLink();
  console.log("1. прошу машину вивантажити свіжий recipe-пакет (машина → портал)…");
  await sendAndWatch("upload", { uptype: "recipe" }, { timeoutS: 60, untilLogged: true });
  // Чекаємо НОВІШЕ посилання за before: інакше ризик пропатчити застарілий
  // стан машини (напр. відкотити ціну). Краще стоп, ніж стара база.
  let url = null;
  for (let waited = 0; waited < 75000; waited += 3000) {
    const cur = await newestRecipeLink();
    if (cur && cur !== before) { url = cur; break; }
    await sleep(3000);
  }
  if (!url) die("машина не виклала свіжий recipe-пакет за 75 с (офлайн?) — не беру застарілий, щоб не відкотити ціни; спробуй пізніше");
  console.log(`2. завантажую свіжий пакет: ${url}`);
  const buf = await getBuffer(url);
  const base = url.split("/").pop();
  writeFileSync(new URL(base, backupDir), buf);
  console.log(`   збережено (точка відкату): jetinno/backups/${today}/${base}  (${buf.length} B)`);
  return { buf, base };
}

// ── Патч .product: лише назви цільових напоїв ──────────────────────────────
function patch(buf) {
  const entries = readZip(buf);
  const prod = entries.find((e) => e.name.endsWith(".product"));
  const recipe = entries.find((e) => e.name.endsWith(".recipe"));
  if (!prod) die("у пакеті немає .product");
  const list = JSON.parse(prod.data.toString("utf8"));
  const diffs = [];
  const targets = Object.entries(RENAMES).filter(([id]) => ONLY == null || Number(id) === ONLY);
  if (ONLY != null && !targets.length) die(`--only ${ONLY}: немає такого в RENAMES`);
  for (const [idStr, want] of targets) {
    const id = Number(idStr);
    const obj = list.find((p) => Number(p.productId) === id);
    if (!obj) { console.log(`   ! productId ${id} немає в пакеті — пропускаю`); continue; }
    const curUk = obj.nameLang?.uk_ ?? "";
    const curCn = obj.nameCN ?? "";
    if (curUk === want && curCn === want) { console.log(`   = ${id} уже «${want}» — пропускаю`); continue; }
    if (!obj.nameLang) obj.nameLang = {};
    obj.nameLang.uk_ = want;
    obj.nameCN = want;                       // машина показує nameCN як головний напис; тримаємо однаковим із uk_
    diffs.push({ id, from: curUk || curCn, to: want });
  }
  // .product назад тим самим форматом (4 пробіли, без екранування кирилиці),
  // як його пише машина; .recipe — байт-у-байт.
  prod.data = Buffer.from(JSON.stringify(list, null, 4), "utf8");
  return { entries, diffs, recipeName: recipe?.name, origRecipe: recipe?.data };
}

// ── Локальна перевірка: .recipe не змінився, .product валідний JSON ─────────
function verifyLocal(origBuf, newBuf) {
  const o = readZip(origBuf), n = readZip(newBuf);
  const oR = o.find((e) => e.name.endsWith(".recipe"))?.data;
  const nR = n.find((e) => e.name.endsWith(".recipe"))?.data;
  if (!oR || !nR || !oR.equals(nR)) die("перевірка: .recipe змінився — стоп (має лишатись недоторканим)");
  const nP = n.find((e) => e.name.endsWith(".product"));
  JSON.parse(nP.data.toString("utf8"));     // валідний JSON
  console.log("   локальна перевірка: .recipe недоторканий, .product — валідний JSON ✓");
}

// ── Залити пакет у портал і надіслати машині ───────────────────────────────
// Завантаження файла в портал — через AetherUpload (chunked uploader порталу):
// preprocess (дає temp-ім'я, chunkSize, group_subdir) → uploading (чанки) →
// savedPath. package_save далі бере file_path=savedPath (не сирий файл — так
// шле сама сторінка /package для storage_space=0).
async function aetherUpload(buf, filename) {
  const hash = createHash("md5").update(buf).digest("hex");
  const pre = await post("/aetherupload/preprocess", {
    resource_name: filename, resource_size: String(buf.length), resource_hash: hash, locale: "en", group: "zip",
  });
  if (pre.error) die(`aetherupload preprocess: ${JSON.stringify(pre)}`);
  const chunkSize = Number(pre.chunkSize) || buf.length;
  const total = Math.max(1, Math.ceil(buf.length / chunkSize));
  let savedPath = "";
  for (let i = 0; i < total; i++) {
    const chunk = buf.subarray(i * chunkSize, Math.min(buf.length, (i + 1) * chunkSize));
    const up = await postForm("/aetherupload/uploading", {
      resource_chunk: { name: filename, data: chunk },
      resource_ext: pre.resourceExt, chunk_total: String(total), chunk_index: String(i + 1),
      resource_temp_basename: pre.resourceTempBaseName, group: "zip", group_subdir: pre.groupSubDir, locale: "en",
      resource_name: filename, resource_size: String(buf.length), resource_hash: hash,
    });
    if (up.savedPath) savedPath = up.savedPath;
  }
  if (!savedPath) die("aetherupload: не повернув savedPath");
  return { savedPath, ext: pre.resourceExt, size: buf.length, name: filename };
}

async function pushPackage(buf, title) {
  const fname = `${title.replace(/[^\w.-]+/g, "_")}.zip`;
  console.log(`4. завантажую патч у портал (AetherUpload + package_save, type=2): «${title}»`);
  const a = await aetherUpload(buf, fname);
  const saved = await post("/package_save", {
    type: "2", title, storage_space: "0", file_path: a.savedPath, name: a.name, size: String(a.size), ext: a.ext, url: "",
  });
  if (saved.status !== "success") die(`package_save не вдалось: ${JSON.stringify(saved)}`);
  const list = await post("/package_get", { type: "2" });
  const mine = (Array.isArray(list) ? list : []).filter((p) => p.title === title).sort((x, y) => y.id - x.id)[0];
  if (!mine) die("package_get: не знайшов щойно завантажений пакет за назвою");
  console.log(`5. надсилаю машині (console_upgrade recipe): url=${mine.url} storage=${mine.storage_space}`);
  const done = await sendAndWatch("upgrade", { uptype: "recipe", package: mine.url, storage: String(mine.storage_space) }, { timeoutS: 120 });
  return done;
}

// ── Звірка з машиною: вивантажити recipe знову й перевірити назви ───────────
async function verifyMachine(wantMap) {
  console.log("6. звіряю: прошу машину вивантажити recipe знову…");
  const before = await newestRecipeLink();
  await sendAndWatch("upload", { uptype: "recipe" }, { timeoutS: 60, untilLogged: true });
  let url = null;
  for (let w = 0; w < 75000; w += 3000) { const c = await newestRecipeLink(); if (c && c !== before) { url = c; break; } await sleep(3000); }
  if (!url) { console.log("   машина не виклала свіжий пакет для звірки — перевір пізніше вручну"); return false; }
  const buf = await getBuffer(url);
  const prod = readZip(buf).find((e) => e.name.endsWith(".product"));
  const list = JSON.parse(prod.data.toString("utf8"));
  let ok = 0, bad = 0;
  for (const [idStr, want] of Object.entries(wantMap)) {
    const obj = list.find((p) => Number(p.productId) === Number(idStr));
    const got = obj?.nameLang?.uk_;
    if (got === want) { ok++; console.log(`   ✓ ${idStr}: «${got}»`); }
    else { bad++; console.log(`   ✗ ${idStr}: на машині «${got}», очікував «${want}»`); }
  }
  console.log(`   усього продуктів на машині: ${list.length}  (назви ок ${ok}, розбіжність ${bad})`);
  return bad === 0;
}

// ── Відкат ─────────────────────────────────────────────────────────────────
if (RESTORE) {
  const buf = readFileSync(RESTORE);
  console.log(`ВІДКАТ: заливаю ${RESTORE} (${buf.length} B) назад на машину`);
  const done = await pushPackage(buf, `restore ${today} ${Date.now()}`);
  console.log(done ? `машина: ${done.status}` : "машина не підтвердила за таймаут — дивись log.mjs");
  process.exit(0);
}

// ── Основний хід ───────────────────────────────────────────────────────────
let freshBuf;
if (FROM) {
  freshBuf = readFileSync(FROM);
  console.log(`локальний пакет (--from, без машини): ${FROM} (${freshBuf.length} B)`);
  if (PUSH) die("--from і --push разом не можна: --push тягне свіжий пакет сам (щоб не залити застарілий)");
} else {
  ({ buf: freshBuf } = await fetchFreshPackage());
}
const { entries, diffs } = patch(freshBuf);
if (!diffs.length) { console.log("\nнема що міняти — усі цільові назви вже стандартні."); process.exit(0); }

console.log("\nзміни назв (productId: було → стане):");
for (const d of diffs) console.log(`  ${String(d.id).padStart(3)}: «${d.from}» → «${d.to}»`);

const patchedBuf = writeZip(entries);
verifyLocal(freshBuf, patchedBuf);
const patchedPath = new URL(`names_patch_${today}${ONLY ? `_only${ONLY}` : ""}.zip`, backupDir);
writeFileSync(patchedPath, patchedBuf);
console.log(`   патч зібрано: jetinno/backups/${today}/${patchedPath.pathname.split("/").pop()}  (${patchedBuf.length} B)`);

if (!PUSH) {
  console.log("\nсуха прогонка — на машину нічого не пішло. Залити: той самий виклик із --push (перший раз краще з --only <productId>).");
  process.exit(0);
}

const wantMap = Object.fromEntries(diffs.map((d) => [d.id, d.to]));
const done = await pushPackage(patchedBuf, `extrovert names ${today}${ONLY ? ` only${ONLY}` : ""}`);
console.log(done ? `   машина (журнал): ${done.status}${done.reason && done.reason !== "--" ? ` (${done.reason})` : ""}` : "   машина не підтвердила за таймаут — перевір log.mjs і звірку нижче");
await sleep(3000);
const good = await verifyMachine(wantMap);
console.log(good ? "\nготово: назви на машині оновлені." : "\n⚠ звірка не зійшлась — якщо напис не змінився або щось зникло, відкат: bun jetinno/scripts/machine-names.mjs --restore <свіжий бекап зі списку вище>");
