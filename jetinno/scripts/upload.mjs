// Попросити машину вивантажити дані в портал: машина → портал, на машину
// нічого не пише (docs/jetinno.md, «Що перевірити першим»).
//   bun jetinno/scripts/upload.mjs product   # напої з цінами → products.mjs
//   bun jetinno/scripts/upload.mjs recipe|config|eva   # файли → «Пакети» в порталі
import { sendAndWatch, die } from "./portal.mjs";

const TYPES = ["product", "recipe", "config", "eva"];
const type = process.argv[2];
if (!TYPES.includes(type)) die(`тип — один із: ${TYPES.join(", ")}`);

const done = await sendAndWatch("upload", { uptype: type });
if (done && type === "product") console.log("далі: bun jetinno/scripts/products.mjs");
