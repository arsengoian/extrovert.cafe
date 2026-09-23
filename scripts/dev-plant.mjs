// Дев-інструмент для кавенятка: перемотати стадію, почистити посаджене,
// зняти добовий гейт і насипати препаратів. Потрібен, щоб перевіряти екрани
// посадки без очікування доби між стадіями.
//
//   bun scripts/dev-plant.mjs --stage 1 --reset     # починаємо з листя
//   bun scripts/dev-plant.mjs --stage 2             # лишити листя, садити гілки
//   bun scripts/dev-plant.mjs --supply 9            # по 9 одиниць кожного
//   bun scripts/dev-plant.mjs --skip                # лише перемотати час
//
// Проти прод-бази запускається через scripts/prod-db.sh (make d-plant),
// бо роута для цього немає й не буде: це пряма правка бази.
import { SQL } from "bun";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1]?.startsWith("--") ? true : args[i + 1] ?? true);
};

const url = process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
if (!url) throw new Error("немає DATABASE_URL_LOCAL у .env");
const sql = new SQL(url);

// Гравця шукаємо за поштою або нікнеймом: нікнейм кирилицею через make на
// Windows приїжджає знаками питання, тож для прод-команд надійніша пошта.
const email = flag("email", null);
const nickname = email ? null : String(flag("nickname", "dev"));
const [user] = email
  ? await sql`select * from users where email = ${String(email)} and deleted_at is null`
  : await sql`select * from users where nickname = ${nickname} and deleted_at is null`;
if (!user) throw new Error(`немає гравця ${email ?? nickname}`);

const [plant] = await sql`select * from plants where owner_id = ${user.id} order by created_at limit 1`;
if (!plant) throw new Error("у гравця немає кавенятка");

const stage = flag("stage");
const reset = flag("reset", false);
const supply = flag("supply");
// --skip нічого не міняє, крім часу: кущ лишається як є, але добовий гейт
// уже минув, і полив не «щойно був». Саме це потрібно, щоб пройти цикл
// росту за один вечір, не підміняючи стадію руками.
const skip = flag("skip", false);

if (skip) {
  await sql`
    update plants
       set last_stage_transition_at = now() - interval '2 days',
           last_watered_at = now() - interval '2 days'
     where id = ${plant.id}`;
}

if (supply !== null) {
  const n = Number(supply) || 9;
  await sql`update users set water_liters = ${n}, compost_kg = ${n}, fertilizer_kg = ${n}, insecticide_bottles = ${n} where id = ${user.id}`;
}

// Посаджене чистимо вибірково: щоб садити гілки, листя має лишитись.
const keepByStage = (appearance, to) => {
  const a = { version: 2, ...appearance };
  delete a.draft;
  if (to <= 1) { a.leaves_bg = []; a.leaves_fg = []; }
  if (to <= 2) a.branches = [];
  if (to <= 3) a.buds = [];
  return a;
};

if (stage !== null || reset) {
  const to = stage === null ? plant.growth_stage : Number(stage);
  const appearance = reset ? keepByStage(plant.appearance, to) : { ...plant.appearance, draft: undefined };
  await sql`
    update plants
       set growth_stage = ${to},
           stage_progress = 0,
           last_stage_transition_at = now() - interval '2 days',
           last_watered_at = now(),
           appearance = ${appearance}
     where id = ${plant.id}`;
}

const [after] = await sql`select growth_stage, appearance from plants where id = ${plant.id}`;
const [care] = await sql`select water_liters, compost_kg, fertilizer_kg, insecticide_bottles from users where id = ${user.id}`;
console.log("✓ кавенятко:", {
  стадія: after.growth_stage,
  листя: (after.appearance.leaves_bg ?? []).length,
  чоло: (after.appearance.leaves_fg ?? []).length,
  гілки: (after.appearance.branches ?? []).length,
  бутони: (after.appearance.buds ?? []).length,
  чернетка: Boolean(after.appearance.draft),
});
console.log("✓ препарати:", care);
await sql.close();
