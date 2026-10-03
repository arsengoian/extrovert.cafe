// Швидка перевірка, що локальний api живий і всі його роути відповідають.
//
//   make smoke        (або bun scripts/smoke.mjs)
//
// Це не тести: тут немає перевірки бізнес-правил. Це відповідь на питання
// «я щось переробив — воно взагалі піднімається?», яке інакше задаєш
// клієнту руками по одному екрану.
import { devGuard } from "./lib/dev-guard.mjs";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api/v1";

// Лише локальний api: токен ми підписуємо самі, ключем із .env (так само,
// як scripts/point-token.mjs), а на проді це був би вхід у чужий акаунт
// повз пошту. Девелоперського входу /auth/dev, яким смоук ходив досі, більше
// немає (03.10.2026).
devGuard("smoke", { writes: false, note: "Підписує 15-хвилинний токен гравця локальним JWT_PRIVATE_KEY і обходить роути." });
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(BASE)) {
  console.error("✗ smoke — лише для локального api (API_BASE на localhost)");
  process.exit(1);
}
if (!process.env.JWT_PRIVATE_KEY) {
  console.error("✗ немає JWT_PRIVATE_KEY у .env — без нього api підписує тимчасовим ключем, і наш токен він не прийме");
  process.exit(1);
}
const { pool } = await import("@extrovert/lib/db.js");
const { signToken } = await import("../backend/api/src/auth.js");
const nick = process.env.SMOKE_NICKNAME || null;
const { rows: [who] } = await pool.query(
  `select u.id, u.nickname from users u
    where u.deleted_at is null and exists (select 1 from plants p where p.owner_id = u.id)
      and ($1::text is null or u.nickname = $1)
    order by u.created_at limit 1`,
  [nick]
);
await pool.end();
if (!who) {
  console.error(`✗ немає гравця з кавенятком${nick ? ` «${nick}»` : ""} — увійди в локальний застосунок поштою або зроби make seed`);
  process.exit(1);
}
console.log(`гравець: ${who.nickname}`);
const headers = { authorization: `Bearer ${signToken(`user:${who.id}`, "user")}` };

const plants = await fetch(`${BASE}/me/plants`, { headers }).then((r) => r.json());
const plant = plants.plants?.[0];
if (!plant) {
  console.error("✗ у дев-гравця немає кавенятка — зроби `make seed`");
  process.exit(1);
}

const routes = [
  "/me", "/me/items", "/me/history", "/me/ledger", "/me/listings", "/me/redemptions",
  "/catalog/items", "/catalog/drinks", "/shop", "/shop/coin-packs",
  "/quiz/profile", "/quiz/drink", "/repost", "/legal", "/legal/terms",
  "/market/plants", "/np/cities?q=київ",
  `/me/plants/${plant.id}`,
  `/me/plants/${plant.id}/planting`,
  `/me/plants/${plant.id}/wardrobe`,
  `/me/plants/${plant.id}/chat`,
];

let failed = 0;
for (const path of routes) {
  const res = await fetch(BASE + path, { headers }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  if (!res.ok) {
    console.log(`✗ ${path}: ${res.status} ${(await res.text()).slice(0, 100)}`);
    failed += 1;
  }
}

console.log(failed
  ? `✗ упало роутів: ${failed} з ${routes.length}`
  : `✓ усі ${routes.length} роутів відповідають`);
process.exit(failed ? 1 : 0);
