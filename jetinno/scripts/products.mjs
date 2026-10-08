// Напої, як їх востаннє звітувала машина, поруч із нашим меню точки.
//   bun jetinno/scripts/products.mjs
// Свіжий список — після `bun jetinno/scripts/upload.mjs product`.
import { machineProducts, menuDrinks } from "./portal.mjs";

const [machine, menu] = await Promise.all([machineProducts(), menuDrinks()]);
if (!machine.length) {
  console.log("машина ще не звітувала напої — спершу: bun jetinno/scripts/upload.mjs product");
  process.exit(0);
}
const byId = new Map(menu.map((d) => [d.productId, d]));
console.log(`звіт машини: ${machine[0].uploaded}`);
for (const p of machine.sort((a, b) => (a.sort || 99) - (b.sort || 99))) {
  const m = byId.get(p.productId);
  const sale = p.salePrice !== p.price ? ` (відпускна ${p.salePrice})` : "";
  const ours = m ? `меню: ${m.name}, ${m.price}` : "в меню немає";
  const flag = m && m.price !== p.salePrice ? "  ⚠ ціна різна" : "";
  console.log(`${String(p.sort).padStart(2)} | ${String(p.productId).padStart(3)} | ${p.price}${sale} | ${p.status} | ${ours}${flag}`);
}
