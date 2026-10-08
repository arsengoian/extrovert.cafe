// Заповнити «Мою продукцію» порталу (carrier_product_map) нашими назвами,
// щоб звіти Jetinno показували «Еспресо», а не каталожне «Чорний кунжут
// фіолетовий рисовий латте» (docs/jetinno.md, «Напої на машині»). Впливає
// лише на портал — на машину й на ціни нічого не йде.
//
//   bun jetinno/scripts/set-names.mjs          # лише показати, що додасть
//   bun jetinno/scripts/set-names.mjs --yes    # додати відсутні
//
// Назви й коди — з нашого меню точки (pos.extrovert.cafe/.../menu.json):
// один напій = один код, код = drinks.slot без нуля попереду. Уже наявні в
// «Моїй продукції» коди пропускаються, тож повторний запуск безпечний.
import { get, post, tableRows, menuDrinks, die } from "./portal.mjs";

const send = process.argv.includes("--yes");

// Усі мовні поля форми обов'язкові (перевірено 08.10.2026), тож кладемо нашу
// назву в кожне: у звітах порталу цього акаунта однаково показується uk.
const LANGS = ["cn", "tw", "en", "ru", "kr", "fr", "ja", "nl", "tr", "pl", "se", "uk", "es", "de", "th", "bg"];

// Коди, які вже є в «Моїй продукції» — таблиця #data_list, код у 5-й колонці
// (чекбокс, №, керування, тип, код). Порожня — рядок «Відсутня інформація».
async function existingCodes() {
  const html = await get("/norm_module/carrier_product_map?perPage=1000&page=1");
  const table = html.match(/<table[^>]*id="data_list"[\s\S]*?<\/table>/i);
  const codes = new Set();
  if (table) for (const r of tableRows(table[0])) if (r.length > 4 && /^\d+$/.test(r[4])) codes.add(Number(r[4]));
  return codes;
}

function saveOne(code, name) {
  const fields = { product_type: "1", product_id: String(code), id: "" };
  for (const l of LANGS) fields[`product_name_${l}`] = name;
  return post("/norm_module/carrier_product_map_save", fields);
}

const menu = await menuDrinks();
if (!menu.length) die("меню точки порожнє — немає звідки брати назви");
const have = await existingCodes();

const todo = menu.filter((d) => Number.isInteger(d.productId) && !have.has(d.productId));
const skip = menu.filter((d) => have.has(d.productId));
for (const d of skip) console.log(`= ${String(d.productId).padStart(3)} ${d.name} — уже є, пропускаю`);
if (!todo.length) { console.log("усі назви вже заведені"); process.exit(0); }

console.log(`\nдодати ${todo.length}:`);
for (const d of todo) console.log(`  ${String(d.productId).padStart(3)} → ${d.name}`);
if (!send) { console.log("\nнічого не надіслано; щоб додати — те саме з --yes"); process.exit(0); }

console.log("");
let ok = 0;
for (const d of todo) {
  const res = await saveOne(d.productId, d.name);
  if (res.status === "success") { ok++; console.log(`✓ ${d.productId} ${d.name}`); }
  else console.log(`✗ ${d.productId} ${d.name}: ${res.info ?? JSON.stringify(res)}`);
}
console.log(`\nдодано ${ok} з ${todo.length}`);
