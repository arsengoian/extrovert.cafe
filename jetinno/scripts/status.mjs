// Стан машини в порталі Jetinno — і заодно перевірка, що кука жива.
//   bun jetinno/scripts/status.mjs
import { post, VMC, die } from "./portal.mjs";

const { data = [] } = await post("/ajax/get_device", { sort: "is_connected" });
const d = data.find((x) => String(x.vmc_no) === VMC);
if (!d) die(`машини ${VMC} в акаунті немає`);
console.log(`${d.vmc_no} ${d.vmc_model} — ${d.is_connected ? "онлайн" : "ОФЛАЙН"}`);
console.log(`  підключилась ${d.last_login}, відключалась ${d.last_logout}`);
console.log(`  несправності ${d.error_count}, попередження ${d.warning_count}, інгредієнти ${d.supply_count}`);
console.log(`  ПЗ ${d.app_version}, IO ${d.io_version}`);
