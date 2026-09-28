// Потік продажів для перевірки точки: раз на EVERY секунд — покупка
// випадкового активного напою тестовим касиром (scripts/dev-sale.mjs), до
// COUNT штук або до Ctrl+C.
//
//   bun scripts/dev-sales.mjs                  # 20 продажів раз на 20 с
//   bun scripts/dev-sales.mjs --every 30 --count 5 --pay cash
//
// Кожен продаж — окремий запуск dev-sale.mjs: там уже є все, що потрібно
// (перевірка, що касир тестовий, відкриття й закриття зміни), і тримати
// другу копію цієї логіки тут означало б рано чи пізно розійтись.
// Інтервал рахується від початку продажу, а не від його кінця: чек у
// Checkbox підписується кілька секунд, і без цього крок плив би.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const every = Math.max(5, Number(flag("every", 20)) || 20);
const count = Math.max(1, Number(flag("count", 20)) || 20);
const pay = flag("pay", "card");
const letter = flag("letter", "a");

const drinks = JSON.parse(readFileSync(path.join(ROOT, "db", "seeds", "drinks.json"), "utf8"))
  .filter((d) => d.active && !d.is_bonus);
if (!drinks.length) { console.error("✗ у сідах немає активних напоїв"); process.exit(1); }

let stopped = false;
process.on("SIGINT", () => { stopped = true; console.log("\nзупиняюсь — поточний продаж допрацює"); });

for (let n = 1; n <= count && !stopped; n++) {
  const started = Date.now();
  const d = drinks[Math.floor(Math.random() * drinks.length)];
  const code = `${letter}${d.slot}`;
  console.log(`\n── продаж ${n} з ${count}: ${d.name} (${code}), ${d.price_uah} ₴ ──`);
  // process.execPath, а не "bun": make з PowerShell кличе bun повним шляхом
  // ($(BUN) у Makefile), а в PATH його там немає — "bun" падав з ENOENT.
  const proc = Bun.spawn([process.execPath, path.join(ROOT, "scripts", "dev-sale.mjs"), "--drink", code, "--pay", pay], {
    cwd: ROOT, stdout: "inherit", stderr: "inherit",
  });
  const code_ = await proc.exited;
  if (code_ !== 0) console.error(`✗ продаж ${n} не вдався (код ${code_}) — іду далі`);
  if (n === count || stopped) break;
  const wait = every * 1000 - (Date.now() - started);
  for (let t = 0; t < wait && !stopped; t += 250) await Bun.sleep(250);
}
console.log("\nготово");
