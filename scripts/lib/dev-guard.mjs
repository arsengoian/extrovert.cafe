// Попередження для дев-скриптів (власник, 03.10.2026): самі скрипти
// лишаються — без них не перевірити екрани, яких інакше чекав би добу, —
// але кожен запуск каже вголос, що він робить і куди.
//
// Прод — база через scripts/prod-db.sh: той ставить EXTROVERT_PROD=1 і
// тунель на :5455. Скрипт, що міняє дані, на проді без явного --prod не
// стартує: зайві монети, чеки чи стадії псують статистику адмінки, і
// прибирати їх потім руками.
//
//   const { prod } = devGuard("dev-give", { writes: true });

const RED = "\x1b[41m\x1b[97m", YEL = "\x1b[43m\x1b[30m", OFF = "\x1b[0m";

export function isProdDb(env = process.env) {
  const url = env.DATABASE_URL_LOCAL || env.DATABASE_URL || "";
  return env.EXTROVERT_PROD === "1" || /@(127\.0\.0\.1|localhost):5455\//.test(url);
}

// writes — скрипт щось міняє (а не лише читає); note — що саме, людською
// мовою, для банера.
export function devGuard(name, { writes = true, note = "" } = {}) {
  const prod = isProdDb();
  const args = process.argv.slice(2);
  const where = prod ? "ПРОД-БАЗА" : "локальна база";
  const colour = prod ? RED : YEL;
  console.warn(`${colour} ⚠ ${name}: дев-інструмент, ${where} ${OFF}`);
  if (note) console.warn(`  ${note}`);
  if (writes) console.warn("  Усе, що він додає (монети, речі, чеки, стадії), видно в статистиці — прибери за собою після перевірки.");
  if (prod && writes && !args.includes("--prod")) {
    console.error(`${RED} ✗ це прод: запусти ще раз із --prod, якщо справді треба ${OFF}`);
    process.exit(1);
  }
  return { prod };
}
