// Дев-інструмент для кавенятка: перемотати стадію, почистити посаджене,
// зняти добовий гейт і насипати препаратів. Потрібен, щоб перевіряти екрани
// посадки без очікування доби між стадіями.
//
//   bun scripts/dev-plant.mjs --stage 1 --reset     # починаємо з листя
//   bun scripts/dev-plant.mjs --stage 2             # лишити листя, садити гілки
//   bun scripts/dev-plant.mjs --supply 9            # по 9 одиниць кожного
//   bun scripts/dev-plant.mjs --skip                # «минула доба» — для ВСІХ кавенят гравця
//   bun scripts/dev-plant.mjs --skip 3              # «минуло три дні» — кущі засумують
//   bun scripts/dev-plant.mjs --stage 3 --plant 2   # друге кавенятко (за часом посадки)
//
// Проти прод-бази запускається через scripts/prod-db.sh (make d-plant),
// бо роута для цього немає й не буде: це пряма правка бази.
import { SQL } from "bun";
import { devGuard } from "./lib/dev-guard.mjs";

devGuard("dev-plant", { note: "Перемотує стадії, знімає добовий гейт і сипле препарати — кущ виростає не так, як у гравців." });

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

// Кавенята гравця за часом посадки. --plant — номер (1, 2…) чи id; без
// нього стадію й очищення міняємо першому, а --skip — усім: час минає для
// всіх кавенят одразу. Раніше і --skip діяв лише на перше, і решта «не
// просили їсти», хоч скільки разів його запускай (власник, 28.09.2026).
const plants = await sql`select * from plants where owner_id = ${user.id} order by created_at`;
if (!plants.length) throw new Error("у гравця немає кавенятка");
const which = flag("plant", null);
const plant = which === null ? plants[0]
  : /^\d+$/.test(String(which)) ? plants[Number(which) - 1]
  : plants.find((p) => p.id === String(which));
if (!plant) throw new Error(`немає кавенятка ${which}: у гравця їх ${plants.length}`);

const stage = flag("stage");
const reset = flag("reset", false);
const supply = flag("supply");
// --skip [N] — «минуло N днів» (типово один): усі часові мітки куща йдуть
// назад на N, порожні лишаються порожніми. Кущ як був, але добовий гейт
// минув, а полив відсунувся рівно на стільки, скільки «пройшло».
//
// Раніше --skip ставив обидві мітки на «дві доби тому» незалежно від того,
// якими вони були. Тож двічі поспіль нічого не додавало, а кущ, не политий
// чотири дні, після «пропуску дня» ставав ЗДОРОВІШИМ — полив «повертався»
// на дві доби (26.09.2026, власник: «команда змінює дату поливання?»).
// Тепер настрій рахується чесно: від 3 днів без поливу — сумне, від 7 —
// зів'яле (routes/plants.js, moodOf).
const skipArg = flag("skip", null);
const skipDays = skipArg === null ? 0 : skipArg === true ? 1 : Number(skipArg);
if (skipArg !== null && !(Number.isInteger(skipDays) && skipDays > 0)) {
  throw new Error("--skip приймає ціле число днів, наприклад --skip 3");
}

if (skipDays) {
  // Усім кавенятам гравця, а з --plant — лише тому.
  const ids = which === null ? plants.map((p) => p.id) : [plant.id];
  await sql`
    update plants
       set last_stage_transition_at = last_stage_transition_at - make_interval(days => ${skipDays}),
           last_watered_at = last_watered_at - make_interval(days => ${skipDays})
     where id in ${sql(ids)}`;
  console.log(`✓ минуло ${skipDays} дн. для ${ids.length} кавенят: ${plants.filter((p) => ids.includes(p.id)).map((p) => p.name || "без імені").join(", ")}`);
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
console.log(`✓ кавенятко ${plants.indexOf(plant) + 1} з ${plants.length} (${plant.name || "без імені"}):`, {
  стадія: after.growth_stage,
  листя: (after.appearance.leaves_bg ?? []).length,
  чоло: (after.appearance.leaves_fg ?? []).length,
  гілки: (after.appearance.branches ?? []).length,
  бутони: (after.appearance.buds ?? []).length,
  чернетка: Boolean(after.appearance.draft),
});
console.log("✓ препарати:", care);
await sql.close();
