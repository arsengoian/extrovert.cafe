// Журнал команд машині — стан кожної: відправлено, виконано, відмова.
//   bun jetinno/scripts/log.mjs [скільки, типово 10]
// Час — UTC+8, час сервера Jetinno (docs/jetinno.md, «Час»).
import { commandLog } from "./portal.mjs";

const rows = await commandLog(Number(process.argv[2]) || 10);
if (!rows.length) console.log("команд ще не було");
for (const c of rows) {
  const what = [c.dataType, c.productId, c.price, c.discount].filter((v) => v && v !== "--").join(" ");
  const reason = c.reason && c.reason !== "--" ? ` (${c.reason})` : "";
  console.log(`${c.created} → ${c.updated} | ${c.type}${what ? ` ${what}` : ""} | ${c.status}${reason}`);
}
