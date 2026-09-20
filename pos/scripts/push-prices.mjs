// Заливає меню точки в R2 під ключем points/<point>/menu.json.
//   bun scripts/push-prices.mjs                  → точка kyiv-01, файл data/prices.json
//   bun scripts/push-prices.mjs kyiv-02          → інша точка, той самий файл
//   bun scripts/push-prices.mjs kyiv-02 ./m.json → інша точка, інший файл
import { readFileSync } from "node:fs";
import { loadEnv, put } from "./lib/r2.mjs";

const POINT = (process.argv[2] && !process.argv[2].includes(".")) ? process.argv[2] : "kyiv-01";
const fileArg = process.argv.find((a, i) => i >= 2 && a.includes("."));
const file = fileArg || new URL("../data/prices.json", import.meta.url);
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(POINT)) {
  console.error("✗ некоректний id точки:", POINT); process.exit(1);
}
const body = readFileSync(file);
JSON.parse(body.toString());                       // впаде, якщо JSON битий

const key = `points/${POINT}/menu.json`;
try {
  // 30 секунд — щоб зміна цін доїхала на екран навіть тоді, коли подія
  // menu.deployed до кіоска не дійшла (docs/services.md §4).
  const n = await put(loadEnv(), {
    key, body, contentType: "application/json", cacheControl: "public, max-age=30"
  });
  console.log(`✓ ${key} залито (${n} B)`);
} catch (e) {
  console.error("✗", e.message); process.exit(1);
}
