// Адмінка. Поки заглушка — і заведена саме як заглушка навмисно: стек
// зібраний, викочується й моніториться цілком, тож коли дійдуть руки до
// справжніх екранів, їх буде куди покласти. Порожній сервіс у compose
// коштує 30 МБ памʼяті; відсутній сервіс коштує переробки деплою.
//
// Доступу ззовні немає й поки не буде: у проді порт опублікований лише на
// 127.0.0.1, тобто зайти можна тунелем (docs/deploy.md §2.3). Тому тут
// свідомо немає ні входу, ні жодної дії, яка щось змінює, — лише лічильники,
// по яких видно, що стек живий.
import Fastify from "fastify";
import { pool } from "@extrovert/lib/db.js";
import { makeLog } from "@extrovert/lib/log.js";
import { onShutdown } from "@extrovert/lib/shutdown.js";

const log = makeLog("admin");
const app = Fastify({ logger: false });
const PORT = Number(process.env.PORT || 3004);

app.get("/healthz", async () => ({ ok: true, service: "admin" }));

// Майбутні розділи. Список тут, а не в доці, щоб заглушка сама показувала,
// чого в ній ще немає.
const SECTIONS = [
  ["Підтримка", "звернення гравців і скарги на напій — переписка в одному місці"],
  ["Точки", "чеки, мовчання автомата, телеметрія"],
  ["Гравці", "пошук за нікнеймом, історія балансу, бани"],
  ["Доставки", "замовлення за зерна, статуси Нової Пошти"],
  ["Економіка", "курс зерна, ціни, ліміти — зараз усе в api/data/economy.json"],
];

const COUNTS = [
  ["гравців", "select count(*)::int as n from users where deleted_at is null"],
  ["чеків сьогодні", "select count(*)::int as n from receipts where created_at >= current_date"],
  ["скарг відкритих", "select count(*)::int as n from problem_reports where status <> 'closed'"],
  ["лотів на маркеті", "select count(*)::int as n from market_listings where status = 'active'"],
];

async function numbers() {
  const out = [];
  for (const [label, sql] of COUNTS) {
    try {
      const { rows } = await pool.query(sql);
      out.push([label, String(rows[0]?.n ?? 0)]);
    } catch (e) {
      // База може бути старішою за цей файл — заглушка не має через це падати.
      out.push([label, "—"]);
      log.error(`лічильник «${label}» не порахувався`, e);
    }
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

app.get("/", async (_req, reply) => {
  const counts = await numbers();
  reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Адмінка extrovert.cafe</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 32px 20px; max-width: 720px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { opacity: .65; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0; }
  .card { border: 1px solid currentColor; border-radius: 10px; padding: 12px 14px; opacity: .9; }
  .n { font-size: 26px; font-weight: 600; }
  li { margin: 6px 0; }
  code { opacity: .7; }
</style></head><body>
<h1>Адмінка</h1>
<p class="muted">Заглушка. Екранів ще немає — сервіс існує, щоб стек був повним і викочувався цілком.</p>
<div class="grid">
  ${counts.map(([label, n]) => `<div class="card"><div class="n">${esc(n)}</div><div class="muted">${esc(label)}</div></div>`).join("")}
</div>
<h2>Що тут буде</h2>
<ul>${SECTIONS.map(([name, what]) => `<li><b>${esc(name)}</b> — <span class="muted">${esc(what)}</span></li>`).join("")}</ul>
<p class="muted"><code>${esc(new Date().toISOString())}</code></p>
</body></html>`);
});

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  log.info("адмінка піднялась", { port: PORT });
} catch (e) {
  log.error("адмінка не піднялась", e);
  process.exit(1);
}

onShutdown({
  "http": () => app.close(),
  "postgres": () => pool.end(),
}, { log, timeoutMs: 15_000 });
