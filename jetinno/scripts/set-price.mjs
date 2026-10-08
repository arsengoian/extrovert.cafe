// Змінити ціну одного напою на машині (console_priceset, docs/jetinno.md).
//   bun jetinno/scripts/set-price.mjs 15 65          # лише показати, що піде
//   bun jetinno/scripts/set-price.mjs 15 65 --yes    # надіслати й перевірити
// Код — product_id машини, тобто drinks.slot без нуля попереду (Мокачино —
// 15). Ціна — гривні, як у діалозі порталу («9.99»). Без --yes нічого не
// шле: ціна на машині — це ціна в чеку покупця.
//
// Зміну ціни машина в журналі не підтверджує (рядок назавжди лишається
// «відправлено»), тож перевірка — свіжий звіт напоїв: після priceset скрипт
// просить машину вивантажити напої й звіряє ціну.
import { sendAndWatch, machineProducts, menuDrinks, VMC, die, sleep } from "./portal.mjs";

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

const sent = await sendAndWatch("priceset", { product_id: String(productId), product_price: String(price) }, { untilLogged: true });
if (!sent) process.exit(1);

console.log("перевіряю: машина вивантажує напої");
await sleep(5000);
const uploaded = await sendAndWatch("upload", { uptype: "product" });
if (!uploaded) die("звіту напоїв немає — перевір пізніше: bun jetinno/scripts/products.mjs");
const after = (await machineProducts()).find((p) => p.productId === productId);
if (after && after.price === price) console.log(`✓ на машині ${price} (звіт ${after.uploaded})`);
else die(`машина звітує ${after ? after.price : "без цього напою"}, а не ${price}`);
