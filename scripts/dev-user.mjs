// Хто це й що в нього є: баланси, препарати, кавенята, останні чеки.
//
//   bun scripts/dev-user.mjs --nickname міцний_помел
//   make d-user NICK=міцний_помел          # те саме, але проти прод-бази
//
// Дивиться в базу напряму, бо це інструмент перевірки, а не екран: тут
// корисно бачити й те, чого гравцю не показують (гейт, час переходу).
import { SQL } from "bun";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1] ?? true;
};

const url = process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
if (!url) throw new Error("немає DATABASE_URL");
const sql = new SQL(url);

// Пошта або нікнейм — див. коментар у dev-plant.mjs про кирилицю в make.
const email = flag("email", null);
const nickname = email ? null : String(flag("nickname", ""));
if (!email && !nickname) throw new Error("вкажи --email або --nickname");
const [user] = email
  ? await sql`select * from users where email = ${String(email)} and deleted_at is null`
  : await sql`select * from users where nickname = ${nickname} and deleted_at is null`;
if (!user) throw new Error(`немає гравця ${email ?? nickname}`);

const plants = await sql`
  select id, name, growth_stage, stage_progress, cycle_phase,
         last_stage_transition_at, last_watered_at,
         last_stage_transition_at + interval '1 day' > now() as гейт
    from plants where owner_id = ${user.id} order by created_at`;

const receipts = await sql`
  select r.fiscal_code, r.total_sum, b.coins_yellow as бонус, b.status, r.fiscal_date
    from receipts r join bonus_grants b on b.receipt_id = r.id
   where b.redeemed_by = ${user.id}
   order by r.fiscal_date desc limit 5`;

const hhmm = (d) => (d ? new Date(d).toLocaleString("uk-UA") : "—");

console.log(`${user.nickname}  ${user.email ?? "без пошти"}`);
console.log(`  монети: ${user.coins_yellow} жовтих, ${user.coins_silver} срібних, ${user.beans} зерен`);
console.log(`  догляд: вода ${user.water_liters} л · компост ${user.compost_kg} кг · добриво ${user.fertilizer_kg} кг · інсектицид ${user.insecticide_bottles} шт`);
console.log(`  згода: ${hhmm(user.consent_at)} · остання поява: ${hhmm(user.last_seen_at)}`);
console.log(`  кавенят: ${plants.length}`);
for (const p of plants) {
  console.log(`    «${p.name ?? "без імені"}» стадія ${p.growth_stage} (${p.stage_progress}) · ${p.cycle_phase}`
    + ` · перехід ${hhmm(p.last_stage_transition_at)}${p.гейт ? " · ГЕЙТ ще діє" : ""}`);
}
console.log(`  чеки з бонусом: ${receipts.length}`);
for (const r of receipts) console.log(`    ${r.fiscal_code} · ${r.total_sum} ₴ · +${r.бонус} · ${r.status} · ${hhmm(r.fiscal_date)}`);

await sql.end();
