// Наповнює локальну базу так, щоб застосунок було на чому дивитись:
// девелоперський гравець, баланси, кавенятко й трохи одягу.
//
//   bun scripts/dev-seed.mjs [--nickname dev] [--reset]
//
// Тільки local: ані стейджа, ані проду тут немає навмисно (roadmap, крок
// 0-біс). Баланси ставляться дельтою в журналі, а не update-ом колонки —
// інакше баланс і журнал розійдуться (db-schema §0).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const url = process.env.DATABASE_URL_LOCAL || env.DATABASE_URL_LOCAL;
if (!url) { console.error("✗ немає DATABASE_URL_LOCAL у .env"); process.exit(1); }

const NICK = arg("nickname", "dev");
const TARGET = { yellow: 1240, silver: 320, beans: 7 };
const CARE = { water_liters: 4, compost_kg: 1, fertilizer_kg: 2, insecticide_bottles: 0 };

const sql = new SQL(url);

const [existing] = await sql`select * from users where nickname = ${NICK}`;
const user = existing ?? (await sql`
    insert into users (nickname, metadata, consent_at, terms_version)
    values (${NICK}, '{"dev": true}'::jsonb, now(), 'dev')
    returning *`)[0];

if (!user.metadata?.dev) {
  console.error(`✗ у ${NICK} немає metadata.dev — скрипт не чіпає чужі акаунти`);
  process.exit(1);
}

// Баланси: рахуємо дельту до цільових значень і пишемо один рядок журналу.
const delta = {
  yellow: TARGET.yellow - user.coins_yellow,
  silver: TARGET.silver - user.coins_silver,
  beans: TARGET.beans - user.beans,
};
if (delta.yellow || delta.silver || delta.beans) {
  await sql.begin(async (tx) => {
    await tx`update users set coins_yellow = ${TARGET.yellow}, coins_silver = ${TARGET.silver},
                              beans = ${TARGET.beans}, water_liters = ${CARE.water_liters},
                              compost_kg = ${CARE.compost_kg}, fertilizer_kg = ${CARE.fertilizer_kg},
                              insecticide_bottles = ${CARE.insecticide_bottles}
              where id = ${user.id}`;
    await tx`insert into ledger_entries (user_id, delta_yellow, delta_silver, delta_beans, reason, meta)
             values (${user.id}, ${delta.yellow}, ${delta.silver}, ${delta.beans}, 'admin',
                     ${{ script: "dev-seed" }})`;
  });
}

// Кавенятко: стадія 5, обличчя з набору 3 — рівно те, що показує дизайн.
// Вигляд беремо з еталонного макета (frontend/client/public/assets/tree_layout.json):
// дев-кущ має виглядати так само, як кущ у дизайні, інакше на екранах
// посадки нема з чим порівняти результат.
const layout = JSON.parse(readFileSync(new URL("../frontend/client/public/assets/tree_layout.json", import.meta.url), "utf8"));
const skinOf = (sprite) => Number(sprite.match(/skin(d+)/)?.[1] ?? 1);
const place = (i) => ({ x: round(i.x), y: round(i.y), rotation: round(i.rotation ?? 0), scale: round(i.scale) });
const round = (v) => Math.round(v * 100) / 100;
const leaves = layout.instances.filter((i) => i.group === "leaves_batch_normal").sort((a, b) => a.z - b.z);
const bodyZ = layout.instances.find((i) => i.group === "body_stage1_sphere").z;

const appearance = {
  version: 2,
  // Листя переднього плану — те, що в макеті лежить вище тіла.
  leaves_bg: leaves.filter((l) => l.z < bodyZ).map((l, n) => ({ id: n + 1, skin: skinOf(l.sprite), ...place(l) })),
  leaves_fg: leaves.filter((l) => l.z > bodyZ).map((l, n) => ({ id: n + 1, skin: skinOf(l.sprite), ...place(l) })),
  branches: layout.instances.filter((i) => i.group === "branch_skins_custom")
    .sort((a, b) => a.z - b.z).map((b, n) => ({ id: n + 1, skin: skinOf(b.sprite), ...place(b) })),
  buds: layout.instances.filter((i) => i.group === "fruit_bud_greenbean")
    .sort((a, b) => a.z - b.z).map((b, n) => ({ id: n + 1, owner: "body", t: null, ...place(b) })),
};

let [plant] = await sql`select * from plants where owner_id = ${user.id} order by created_at limit 1`;
if (!plant) {
  [plant] = await sql`
    insert into plants (owner_id, name, growth_stage, face_set_id, cycle_phase,
                        last_watered_at, last_stage_transition_at, appearance)
    values (${user.id}, 'Барні', 5, 3, 'initial', now() - interval '1 day',
            now() - interval '2 days', ${appearance})
    returning *`;
} else if ((plant.appearance?.version ?? 1) < 2) {
  // Стара форма appearance (частки сцени) більше не рендериться — оновлюємо.
  [plant] = await sql`update plants set appearance = ${appearance} where id = ${plant.id} returning *`;
}

// Одяг: кілька предметів із каталогу, зокрема повний ковбойський набір.
const [{ owned }] = await sql`select count(*)::int as owned from user_items where user_id = ${user.id}`;
if (owned === 0) {
  const codes = ["cowboy_head", "cowboy_body", "cowboy_pants", "cowboy_feet", "cowboy_acc",
                 "barista_head", "skater_body", "dj_acc", "cowboy_head"];
  for (const code of codes) {
    const [def] = await sql`select id from item_defs where code = ${code}`;
    if (!def) continue;
    await sql`insert into user_items (user_id, item_def_id, acquired_from) values (${user.id}, ${def.id}, 'admin')`;
  }
}

// Чек із покупкою: без нього немає ні «Покупок», ні квіза про напій.
// Той самий шлях, що й у проді: чек → bonus_grant → гравець його забрав.
const [receipts] = await sql`select count(*)::int as n from receipts`;
if (receipts.n === 0) {
  const drinks = await sql`select system_code, name, price_uah from drinks where active order by sort_order limit 2`;
  const [receipt] = await sql`
    insert into receipts (point_id, checkbox_receipt_id, fiscal_date, total_sum, source, tax_url)
    values ('kyiv-01', gen_random_uuid(), now() - interval '2 hours',
            ${drinks.reduce((s, d) => s + Number(d.price_uah), 0)}, 'poll',
            'https://cabinet.tax.gov.ua/cashregs/check')
    returning id`;
  for (const d of drinks) {
    await sql`insert into receipt_items (receipt_id, system_code, name, qty, price_uah, sum_uah)
              values (${receipt.id}, ${d.system_code}, ${d.name}, 1, ${d.price_uah}, ${d.price_uah})`;
  }
  await sql`insert into bonus_grants (receipt_id, point_id, coins_yellow, claim_token, expires_at,
                                      claimed_at, redeemed_by, redeemed_at, status)
            values (${receipt.id}, 'kyiv-01', 26, ${"dev-" + Math.random().toString(36).slice(2)},
                    now() + interval '2 minutes', now(), ${user.id}, now(), 'redeemed')`;
  console.log("✓ чек із двома напоями й забраним бонусом");
}

// Довідник Нової Пошти: у проді його щодоби тягне scheduler, локально ключа
// НП зазвичай немає — тому кілька вигаданих міст і відділень, щоб чекаут
// можна було пройти цілком. Ref-и навмисно не схожі на справжні.
const [{ cities }] = await sql`select count(*)::int as cities from np_cities`;
if (cities === 0) {
  const fixture = [
    ["dev-city-kyiv", "Київ", "Київська обл.", [
      ["dev-wh-k1", 1, "branch", "Відділення №1: вул. Хрещатик, 22", null],
      ["dev-wh-k12", 12, "branch", "Відділення №12: вул. Миколи Мишуги, 8", null],
      ["dev-wh-k77", 77, "postomat", "Поштомат №77: вул. Миколи Мишуги, 8 (магазин)",
        { length_cm: 40, width_cm: 35, height_cm: 17 }],
      ["dev-wh-k91", 91, "postomat", "Поштомат №91: просп. Науки, 1 (маленький)",
        { length_cm: 20, width_cm: 15, height_cm: 8 }],
    ]],
    ["dev-city-lviv", "Львів", "Львівська обл.", [
      ["dev-wh-l3", 3, "branch", "Відділення №3: вул. Городоцька, 100", null],
      ["dev-wh-l45", 45, "postomat", "Поштомат №45: вул. Стрийська, 30",
        { length_cm: 40, width_cm: 35, height_cm: 17 }],
    ]],
    ["dev-city-odesa", "Одеса", "Одеська обл.", [
      ["dev-wh-o7", 7, "branch", "Відділення №7: вул. Дерибасівська, 5", null],
    ]],
  ];
  for (const [ref, name, area, warehouses] of fixture) {
    await sql`insert into np_cities (ref, name, area, settlement_type)
              values (${ref}, ${name}, ${area}, 'місто')`;
    for (const [wRef, number, category, description, limits] of warehouses) {
      await sql`insert into np_warehouses (ref, city_ref, number, category, description,
                                           short_address, place_max_weight_kg, dimension_limits, status)
                values (${wRef}, ${ref}, ${number}, ${category}, ${description}, ${description},
                        ${category === "postomat" ? 20 : 1000}, ${limits}, 'Working')`;
    }
  }
  console.log("✓ довідник НП: 3 міста, 7 відділень (вигадані, лише local)");
}

const [summary] = await sql`
  select u.nickname, u.coins_yellow, u.coins_silver, u.beans,
         (select count(*)::int from plants where owner_id = u.id) as plants,
         (select count(*)::int from user_items where user_id = u.id) as items
    from users u where u.id = ${user.id}`;
console.log("✓ гравець:", summary);
await sql.close();
