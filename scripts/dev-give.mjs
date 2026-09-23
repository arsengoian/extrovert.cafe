// Накинути (чи забрати) гравцю монети й зерна — для перевірок, яких інакше
// довелось би чекати добу.
//
//   bun scripts/dev-give.mjs --email хтось@пошта --coins 500
//   make d-give MAIL=хтось@пошта COINS=500 BEANS=10 SILVER=40
//   make d-give MAIL=хтось@пошта COINS=-100       # і забрати теж
//
// Пишемо не лише в users, а й рядок у ledger_entries з reason='admin'
// (db-schema §3): на журналі тримається вся статистика адмінки, і баланс,
// що зʼявився повз нього, зробив би «нарахування монет» неправдою. Саме так
// робить і сідер (scripts/dev-seed.mjs).
//
// Мінус у балансі база не дозволить (CHECK >= 0) — забрати більше, ніж є,
// не вийде, і це правильно: від'ємний баланс зламав би всі екрани.
import { SQL } from "bun";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1] ?? true;
};
const num = (name) => {
  const v = flag(name, null);
  if (v === null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name}: треба ціле число, а не «${v}»`);
  return n;
};

const url = process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
if (!url) throw new Error("немає DATABASE_URL");
const sql = new SQL(url);

// Пошта або нікнейм — див. коментар у dev-plant.mjs про кирилицю в make.
const email = flag("email", null);
const nickname = email ? null : String(flag("nickname", ""));
if (!email && !nickname) throw new Error("вкажи --email або --nickname");

const yellow = num("coins");
const silver = num("silver");
const beans = num("beans");
if (!yellow && !silver && !beans) {
  throw new Error("нема що нараховувати: вкажи --coins, --silver чи --beans");
}

const [user] = email
  ? await sql`select * from users where email = ${String(email)} and deleted_at is null`
  : await sql`select * from users where nickname = ${nickname} and deleted_at is null`;
if (!user) throw new Error(`немає гравця ${email ?? nickname}`);

const [after] = await sql.begin(async (tx) => {
  await tx`
    insert into ledger_entries (user_id, delta_yellow, delta_silver, delta_beans, reason, meta)
    values (${user.id}, ${yellow}, ${silver}, ${beans}, 'admin', ${{ by: "dev-give" }})`;
  return tx`
    update users
       set coins_yellow = coins_yellow + ${yellow},
           coins_silver = coins_silver + ${silver},
           beans = beans + ${beans}
     where id = ${user.id}
     returning nickname, coins_yellow, coins_silver, beans`;
});

const sign = (n) => (n > 0 ? `+${n}` : String(n));
const parts = [
  yellow && `${sign(yellow)} жовтих`,
  silver && `${sign(silver)} срібних`,
  beans && `${sign(beans)} зерен`,
].filter(Boolean);

console.log(`✓ ${after.nickname}: ${parts.join(", ")}`);
console.log(`  тепер: ${after.coins_yellow} жовтих, ${after.coins_silver} срібних, ${after.beans} зерен`);

await sql.end();
