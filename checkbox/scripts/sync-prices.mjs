// Синхронізує ціни з pos/data/prices.json у каталог товарів Checkbox.
//
// Товар у Checkbox не має API для точкового PATCH ціни — тільки
// експорт/імпорт файлом цілого каталогу (docs/checkbox.md, "Товари").
// Тому тут: 1) експортувати поточний каталог, 2) підмінити лише price
// у знайдених за кодом товарах, 3) залити той самий файл назад. Інші
// поля (group, taxes, uktzed, ...) не займаємо — беремо їх з експорту
// такими, як є, щоб не затерти щось, чим цей скрипт не керує.
//
// Мапінг назва->код прописаний руками (звірено з реальним експортом
// 09.09.2026, Товари.xlsx): у prices.json нема поля код, а дві назви
// в Checkbox відрізняються від наших ("Флет вайт" без дефіса,
// просто "Шоколад" замість "Гарячий шоколад") — фазі matching за
// іменем тут не довіряти.
//
// За замовчуванням — сухий прогін (тільки друкує різницю й пише
// прев'ю-файл). Реальний імпорт — лише з --apply: це живий каталог
// реального ФОП, ціни звідси йдуть у фіскальні чеки.
//
//   node scripts/sync-prices.mjs             # прев'ю
//   node scripts/sync-prices.mjs --apply     # застосувати

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = process.env.CHECKBOX_GOODS_API || "https://api.checkbox.ua";
const TOKEN = process.env.CHECKBOX_GOODS_TOKEN;
const CLIENT_NAME = process.env.CHECKBOX_CLIENT_NAME || "extrovert-pos";
const CLIENT_VERSION = process.env.CHECKBOX_CLIENT_VERSION || "1.0.0";
const APPLY = process.argv.includes("--apply");

// prices.json name -> Checkbox "Код" (не штрихкод — barcode/barcodes у
// звірених товарах порожні, унікальний ключ саме код).
const CODE_BY_NAME = {
  "Американо": "a034",
  "Американо з молоком": "a036",
  "Еспресо": "a033",
  "Ірландський віскі": "a018",
  "Какао": "a024",
  "Капучино": "a038",
  "Еспресо з молоком": "a0102",
  "Лате": "a039",
  "Лунго": "a027",
  "Мокачино": "a015",
  "Подвійний еспресо": "a026",
  "Флет-вайт": "a017",      // Checkbox: "Флет вайт" (пробіл, не дефіс)
  "Гарячий шоколад": "a022", // Checkbox: просто "Шоколад"
  // "Американо з бонусами" / "Капучино з бонусами" тут навмисно нема:
  // це кіоскові гейміфікаційні варіанти того самого напою, окремого
  // товару в Checkbox під них не заведено.
};

function authHeaders(extra = {}) {
  if (!TOKEN) {
    console.error("CHECKBOX_GOODS_TOKEN не задано — токен з кабінету checkbox.ua, дивись .env.example");
    process.exit(1);
  }
  return {
    Authorization: `Bearer ${TOKEN}`,
    "X-Client-Name": CLIENT_NAME,
    "X-Client-Version": CLIENT_VERSION,
    ...extra,
  };
}

async function pollTask(kind, taskId, wantStatus) {
  const url = `${API}/api/v1/goods/${kind}/task_status/${taskId}`;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(url, { headers: authHeaders({ accept: "application/json" }) });
    if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (body.status === wantStatus) return body;
    if (body.status === "failed" || body.status === "error")
      throw new Error(`завдання ${taskId} впало: ${JSON.stringify(body)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${kind}/${taskId} не дійшов до статусу "${wantStatus}" за 60с`);
}

async function exportGoods() {
  const res = await fetch(`${API}/api/v1/goods/export/json`, { headers: authHeaders({ accept: "application/json" }) });
  if (!res.ok) throw new Error(`export/json -> ${res.status}: ${await res.text()}`);
  const { task_id } = await res.json();
  await pollTask("export", task_id, "done");
  const fileRes = await fetch(`${API}/api/v1/goods/export/file/${task_id}`, { headers: authHeaders({ accept: "application/json" }) });
  if (!fileRes.ok) throw new Error(`export/file -> ${fileRes.status}: ${await fileRes.text()}`);
  return fileRes.json(); // { goods: [...], branches: ... }
}

async function importGoods(payload) {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }), "prices-sync.json");
  // Без ручного Content-Type: fetch сам виставляє multipart/form-data
  // з правильним boundary — виставити його вручну означає зламати межу.
  const res = await fetch(`${API}/api/v1/goods/import/upload?ignore_barcode_duplicates=true&auto_supply=false`, {
    method: "POST",
    headers: authHeaders({ accept: "application/json" }),
    body: form,
  });
  if (!res.ok) throw new Error(`import/upload -> ${res.status}: ${await res.text()}`);
  const { task_id } = await res.json();
  await pollTask("import", task_id, "completed");

  const applyRes = await fetch(`${API}/api/v1/goods/import/apply_changes/${task_id}`, {
    method: "POST",
    headers: authHeaders({ accept: "application/json" }),
  });
  if (!applyRes.ok) throw new Error(`apply_changes -> ${applyRes.status}: ${await applyRes.text()}`);
  const { task_id: task2 } = await applyRes.json();
  await pollTask("import", task2, "done");
}

function loadPrices() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const p = path.join(here, "..", "..", "pos", "data", "prices.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

async function main() {
  const prices = loadPrices();
  const current = await exportGoods();
  const byCode = new Map(current.goods.map((g) => [g.code, g]));

  const changes = [];
  const unmapped = [];
  const missing = [];
  for (const d of prices.drinks) {
    const code = CODE_BY_NAME[d.name];
    if (!code) { unmapped.push(d.name); continue; }
    const g = byCode.get(code);
    if (!g) { missing.push(`${d.name} (${code})`); continue; }
    const oldPrice = Number(g.price);
    if (oldPrice !== d.price) {
      changes.push({ name: d.name, code, from: oldPrice, to: d.price });
      g.price = d.price.toFixed(2);
    }
  }

  console.log(APPLY ? "=== буде застосовано ===" : "=== прев'ю (сухий прогін) ===");
  if (changes.length) {
    for (const c of changes) console.log(`  ${c.name} (${c.code}): ${c.from} -> ${c.to} ₴`);
  } else {
    console.log("  різниці немає — Checkbox уже збігається з prices.json");
  }
  if (unmapped.length) console.log(`Без коду Checkbox (пропущено): ${unmapped.join(", ")}`);
  if (missing.length) console.log(`Є в мапінгу, але відсутні в експорті Checkbox: ${missing.join(", ")}`);

  if (!changes.length) return;

  if (!APPLY) {
    const outPath = path.join(process.cwd(), "checkbox-goods-preview.json");
    writeFileSync(outPath, JSON.stringify(current, null, 2));
    console.log(`Прев'ю з новими цінами записано в ${outPath}.`);
    console.log("Запустіть з --apply, щоб реально залити зміни в Checkbox.");
    return;
  }

  await importGoods(current);
  console.log("Готово — ціни оновлено в Checkbox.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
