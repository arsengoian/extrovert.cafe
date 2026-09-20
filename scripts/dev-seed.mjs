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
let [plant] = await sql`select * from plants where owner_id = ${user.id} order by created_at limit 1`;
if (!plant) {
  [plant] = await sql`
    insert into plants (owner_id, name, growth_stage, face_set_id, cycle_phase,
                        last_watered_at, last_stage_transition_at, appearance)
    values (${user.id}, 'Барні', 5, 3, 'initial', now() - interval '1 day',
            now() - interval '2 days', ${{
              leaves: [
                { leaf_id: "leaf_01", zone: "top", x: 0.41, y: 0.18, sprite_id: "leaf_skin1_normal", locked: true },
                { leaf_id: "leaf_02", zone: "left", x: 0.16, y: 0.42, sprite_id: "leaf_skin3_normal", locked: true },
                { leaf_id: "leaf_03", zone: "right", x: 0.82, y: 0.40, sprite_id: "leaf_skin5_normal", locked: true },
              ],
              branches: [
                { branch_id: "arm_left", zone: "arm_left", x: 0.06, y: 0.55, sprite_id: "branch_custom_skin1", locked: true },
                { branch_id: "arm_right", zone: "arm_right", x: 0.94, y: 0.55, sprite_id: "branch_custom_skin2", locked: true },
              ],
              fruits: [{ fruit_id: "bud_01", zone: "crown", x: 0.52, y: 0.30, state: "bud", sprite_id: "fruit_bud" }],
            }}
    returning *`;
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

const [summary] = await sql`
  select u.nickname, u.coins_yellow, u.coins_silver, u.beans,
         (select count(*)::int from plants where owner_id = u.id) as plants,
         (select count(*)::int from user_items where user_id = u.id) as items
    from users u where u.id = ${user.id}`;
console.log("✓ гравець:", summary);
await sql.close();
