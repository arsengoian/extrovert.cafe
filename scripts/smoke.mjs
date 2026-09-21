// Швидка перевірка, що локальний api живий і всі його роути відповідають.
//
//   make smoke        (або bun scripts/smoke.mjs)
//
// Це не тести: тут немає перевірки бізнес-правил. Це відповідь на питання
// «я щось переробив — воно взагалі піднімається?», яке інакше задаєш
// клієнту руками по одному екрану.
const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api/v1";

const login = await fetch(`${BASE}/auth/dev`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nickname: process.env.SMOKE_NICKNAME || "dev" }),
}).then((r) => r.json()).catch(() => null);

if (!login?.token) {
  console.error("✗ api не відповів на девелоперський вхід — він узагалі піднятий? (make api)");
  process.exit(1);
}
const headers = { authorization: `Bearer ${login.token}` };

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
