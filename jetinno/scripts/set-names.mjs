// Завести/виправити наші назви в «Моїй продукції» порталу
// (carrier_product_map), щоб звіти Jetinno показували «Еспресо», а не
// каталожне «Чорний кунжут фіолетовий рисовий латте» чи назву зовсім іншого
// напою з глобального каталогу (docs/jetinno.md, «Напої на машині»).
// Впливає лише на портал — на машину й на ціни нічого не йде.
//
//   bun jetinno/scripts/set-names.mjs          # лише показати, що зробить
//   bun jetinno/scripts/set-names.mjs --yes    # завести відсутні, виправити чужі
//
// Українські назви й коди — з нашого меню точки (один напій = один код =
// drinks.slot без нуля попереду). Англійських канонічних назв у нашій
// системі немає, тож вони задані тут, за українськими (EN). Ставимо uk і en;
// решту мов (поля форми обов'язкові) заповнюємо англійською як універсальним
// фолбеком. Запис, де вже стоять наші uk+en, пропускається; повторний запуск
// безпечний.
import { get, post, menuDrinks, die } from "./portal.mjs";

const send = process.argv.includes("--yes");

// Канонічні англійські назви за українськими (у системі їх немає — задано
// тут). Напій без запису тут отримає en = українську назву (фолбек).
const EN = {
  "Еспресо": "Espresso",
  "Подвійний еспресо": "Double Espresso",
  "Еспресо з молоком": "Cortado",
  "Лунго": "Lungo",
  "Американо": "Americano",
  "Американо з молоком": "Americano with Milk",
  "Капучино": "Cappuccino",
  "Лате": "Latte",
  "Флет-вайт": "Flat White",
  "Мокачино": "Mochaccino",
  "Гарячий шоколад": "Hot Chocolate",
  "Какао": "Cocoa",
};

const LANGS = ["cn", "tw", "en", "ru", "kr", "fr", "ja", "nl", "tr", "pl", "se", "uk", "es", "de", "th", "bg"];

// Чинні записи «Моєї продукції»: product_id → { id, uk, en }. id — ключ рядка
// для редагування (порожній id у формі = новий запис). Беремо з data-json
// кнопки редагування — там повний запис.
async function existing() {
  const html = await get("/norm_module/carrier_product_map?perPage=1000&page=1");
  const table = html.match(/<table[^>]*id="data_list"[\s\S]*?<\/table>/i);
  const map = new Map();
  if (table) {
    for (const m of table[0].matchAll(/data-json="([^"]*)"/g)) {
      try {
        const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
        if (j.product_id != null && j.id != null) {
          map.set(Number(j.product_id), { id: j.id, uk: j.product_name_uk ?? "", en: j.product_name_en ?? "" });
        }
      } catch { /* не наш рядок */ }
    }
  }
  return map;
}

// Усі мови — англійською, зверху перекриваємо uk нашою назвою: у звітах
// цього акаунта показується uk, en — друге корисне, решта просто не порожні.
function saveOne(code, uk, en, id = "") {
  const fields = { product_type: "1", product_id: String(code), id: String(id) };
  for (const l of LANGS) fields[`product_name_${l}`] = en;
  fields.product_name_uk = uk;
  return post("/norm_module/carrier_product_map_save", fields);
}

const menu = await menuDrinks();
if (!menu.length) die("меню точки порожнє — немає звідки брати назви");
const have = await existing();

const plan = [];
for (const d of menu) {
  if (!Number.isInteger(d.productId)) continue;
  const en = EN[d.name] ?? d.name;
  if (!EN[d.name]) console.log(`! ${d.name}: немає англійської в EN — ставлю українську; додай у скрипт`);
  const cur = have.get(d.productId);
  if (cur && cur.uk === d.name && cur.en === en) { console.log(`= ${String(d.productId).padStart(3)} ${d.name} — уже наша, пропускаю`); continue; }
  plan.push({ code: d.productId, uk: d.name, en, id: cur?.id ?? "", action: cur ? "виправити" : "додати", was: cur?.uk });
}
if (!plan.length) { console.log("усі назви вже наші"); process.exit(0); }

console.log("");
for (const p of plan) console.log(`  ${p.action} ${String(p.code).padStart(3)} → ${p.uk} / ${p.en}${p.was ? `  (було «${p.was}»)` : ""}`);
if (!send) { console.log("\nнічого не надіслано; щоб застосувати — те саме з --yes"); process.exit(0); }

console.log("");
let ok = 0;
for (const p of plan) {
  const res = await saveOne(p.code, p.uk, p.en, p.id);
  if (res.status === "success") { ok++; console.log(`✓ ${p.code} ${p.uk}`); }
  else console.log(`✗ ${p.code} ${p.uk}: ${res.info ?? JSON.stringify(res)}`);
}
console.log(`\nготово ${ok} з ${plan.length}`);
