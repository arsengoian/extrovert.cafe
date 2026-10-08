// Змінити ціну одного напою на машині (console_priceset, docs/jetinno.md).
//   bun jetinno/scripts/set-price.mjs 15 65          # лише показати, що піде
//   bun jetinno/scripts/set-price.mjs 15 65 --yes    # надіслати
// Код — product_id машини, тобто drinks.slot без нуля попереду (Мокачино —
// 15). Ціна — гривні, як у діалозі порталу («9.99»). Без --yes нічого не
// шле: ціна на машині — це ціна в чеку покупця.
import { sendAndWatch, machineProducts, menuDrinks, VMC, die } from "./portal.mjs";

const [idArg, priceArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--yes");
const productId = Number(idArg);
const price = Number(priceArg);
if (!Number.isInteger(productId) || productId <= 0 || productId >= 60000) die("код напою — ціле від 1 до 59999");
if (!Number.isFinite(price) || price < 0) die("ціна — число ≥ 0, у гривнях");

const [machine, menu] = await Promise.all([machineProducts(), menuDrinks()]);
const now = machine.find((p) => p.productId === productId);
const ours = menu.find((d) => d.productId === productId);
console.log(`машина ${VMC}, напій ${productId}`);
console.log(`  зараз на машині: ${now ? `${now.price} (звіт ${now.uploaded})` : "невідомо — машина цей код не звітувала"}`);
console.log(`  у нашому меню:   ${ours ? `${ours.name}, ${ours.price}` : "немає"}`);
console.log(`  нова ціна:       ${price}`);
if (!send) {
  console.log("\nнічого не надіслано; щоб надіслати — те саме з --yes");
  process.exit(0);
}

const done = await sendAndWatch("priceset", { product_id: String(productId), product_price: String(price) });
if (done) console.log("перевірити, що прийняла: bun jetinno/scripts/upload.mjs product, потім products.mjs");
