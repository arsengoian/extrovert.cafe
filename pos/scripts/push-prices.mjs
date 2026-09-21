// Збирає меню точки з бази й заливає в R2 під ключем points/<point>/menu.json.
//
//   bun pos/scripts/push-prices.mjs              → точка kyiv-01
//   bun pos/scripts/push-prices.mjs kyiv-02      → інша точка
//   bun pos/scripts/push-prices.mjs --dry        → показати меню, нічого не заливати
//
// Напої беруться з таблиці `drinks` — вона єдине джерело правди (сід у
// db/seeds/drinks.json, правки через `bun run seed:apply`). Раніше поруч
// лежав pos/data/prices.json із тими самими напоями, і два списки
// розходились: ціну міняли в одному місці, кіоск показував інше, каса —
// третє. Тепер у файлі лишилось те, що напоями не є: тема, бренд, стакани
// й акція (pos/data/menu-chrome.json).
import { readFileSync } from "node:fs";
import { pool } from "@extrovert/lib/db.js";
import { loadEnv, put } from "./lib/r2.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const POINT = args.find((a) => !a.startsWith("--") && !a.includes(".")) || "kyiv-01";

if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(POINT)) {
  console.error("✗ некоректний id точки:", POINT);
  process.exit(1);
}

const chrome = JSON.parse(readFileSync(new URL("../data/menu-chrome.json", import.meta.url), "utf8"));
delete chrome.$comment;

// active = false прибирає напій з екрана, але лишає його в базі: бонус-напої
// й сезонні позиції повертаються, а історія чеків на них має лишитись.
const { rows } = await pool.query(
  `select system_code, name, vol, cup, price_uah, color, foam, sprite, bonus_coins
     from drinks
    where active
    order by sort_order, name`
);

if (!rows.length) {
  console.error("✗ у базі немає активних напоїв — меню вийшло б порожнім");
  process.exit(1);
}

const menu = {
  ...chrome,
  // Дата збірки, а не дата правки файла: кіоск показує її в куті екрана,
  // і питання там завжди одне — «коли це меню поїхало на точку».
  updated: new Date().toISOString().slice(0, 10),
  drinks: rows.map((d) => ({
    name: d.name,
    vol: d.vol ?? "",
    price: Number(d.price_uah),
    color: d.color ?? "#402212",
    foam: d.foam,
    cup: d.cup ?? "M",
    sprite: d.sprite ?? "",
    system_code: d.system_code,
    // Нуль у меню не потрібен: картка з бейджем бонусу й без нього — різні
    // шаблони, і кіоск вибирає їх саме за наявністю поля.
    ...(d.bonus_coins > 0 ? { bonus_coins: d.bonus_coins } : {}),
  })),
};

const body = Buffer.from(JSON.stringify(menu, null, 2) + "\n");
const key = `points/${POINT}/menu.json`;

if (dry) {
  console.log(`${key} — ${menu.drinks.length} напоїв, ${body.length} B (нічого не залито)`);
  console.log(menu.drinks.map((d) => `  ${d.system_code}  ${d.name} — ${d.price} ₴`).join("\n"));
  await pool.end();
  process.exit(0);
}

try {
  // 30 секунд — щоб зміна цін доїхала на екран навіть тоді, коли подія
  // menu.deployed до кіоска не дійшла (docs/services.md §4).
  const n = await put(loadEnv(), {
    key, body, contentType: "application/json", cacheControl: "public, max-age=30",
  });
  console.log(`✓ ${key} залито (${menu.drinks.length} напоїв, ${n} B)`);
} catch (e) {
  console.error("✗", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
