// Сіди: контентні таблиці лежать у db/seeds/*.json, а цей скрипт возить їх
// в обидва боки (docs/db-schema.md §7).
//
//   bun run seed:apply --env local            показати різницю, нічого не писати
//   bun run seed:apply --env local --apply    записати
//   bun run seed:pull  --env prod             база → JSON, далі git diff
//   bun run seed:apply --env stage --table drinks --apply
//
// Правила, які тут зашиті:
//   * у рядку рівно колонки з manifest — зайва чи відсутня валить прогін;
//   * нічого не видаляється: рядок, якого немає в JSON, потрапляє у звіт;
//   * усе в одній транзакції — або застосувалось цілком, або нічого;
//   * prod вимагає явного --env prod, за замовчуванням local.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SEEDS = path.join(ROOT, "db", "seeds");

// ── аргументи ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const MODE = argv[0] === "pull" ? "pull" : "apply";
const ENV = value("env", "local");
const ONLY = value("table", null);
const WRITE = flag("apply");

// ── конфіг: кореневий .env, змінні оточення мають пріоритет ──────────────
function env() {
  let fromFile = {};
  try {
    fromFile = Object.fromEntries(
      readFileSync(path.join(ROOT, ".env"), "utf8")
        .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
  } catch { /* .env немає — лишаються змінні оточення */ }
  return { ...fromFile, ...process.env };
}

function databaseUrl() {
  const key = `DATABASE_URL_${ENV.toUpperCase()}`;
  const url = env()[key];
  if (!url) {
    console.error(`✗ немає ${key} у .env — оточення «${ENV}» невідоме`);
    process.exit(1);
  }
  return url;
}

// ── manifest і файли ─────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(path.join(SEEDS, "manifest.json"), "utf8"));
const tables = Object.entries(manifest).filter(([name]) => !ONLY || name === ONLY);
if (ONLY && tables.length === 0) {
  console.error(`✗ таблиці «${ONLY}» немає в manifest.json`);
  process.exit(1);
}

// Текст із переносами пишеться масивом рядків, щоб диф був порядковим.
const fromJson = (v) => (Array.isArray(v) ? v.join("\n") : v);
const toJson = (v) => (typeof v === "string" && v.includes("\n") ? v.split("\n") : v);

function readSeed(table, columns, key) {
  const file = path.join(SEEDS, `${table}.json`);
  if (!existsSync(file)) return null;
  const rows = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${table}.json: очікувався масив рядків`);
  const seen = new Set();
  return rows.map((row, i) => {
    const keys = Object.keys(row);
    const extra = keys.filter((k) => !columns.includes(k));
    const missing = columns.filter((k) => !keys.includes(k));
    if (extra.length) throw new Error(`${table}.json[${i}]: зайві колонки ${extra.join(", ")}`);
    if (missing.length) throw new Error(`${table}.json[${i}]: бракує колонок ${missing.join(", ")}`);
    const natural = String(row[key]);
    if (seen.has(natural)) throw new Error(`${table}.json: ключ ${natural} трапляється двічі`);
    seen.add(natural);
    return Object.fromEntries(columns.map((c) => [c, fromJson(row[c])]));
  });
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ── звіт ─────────────────────────────────────────────────────────────────
function report(table, diff) {
  const parts = [];
  if (diff.added.length) parts.push(`${diff.added.length} нових`);
  if (diff.changed.length) parts.push(`${diff.changed.length} змінених`);
  if (diff.unchanged) parts.push(`${diff.unchanged} без змін`);
  if (diff.extra.length) parts.push(`${diff.extra.length} лише в базі`);
  console.log(`\n${table}: ${parts.join(", ") || "порожньо"}`);
  for (const row of diff.added.slice(0, 10)) console.log(`  + ${row.__key}`);
  if (diff.added.length > 10) console.log(`  + … ще ${diff.added.length - 10}`);
  for (const { key, fields } of diff.changed.slice(0, 10)) {
    console.log(`  ~ ${key}: ${fields.map((f) => f.name).join(", ")}`);
    for (const f of fields.slice(0, 3)) {
      const short = (v) => String(v ?? "null").replace(/\s+/g, " ").slice(0, 60);
      console.log(`      ${f.name}: ${short(f.from)} → ${short(f.to)}`);
    }
  }
  if (diff.changed.length > 10) console.log(`  ~ … ще ${diff.changed.length - 10}`);
  // Нічого не видаляємо: на контент посилаються дані гравців, прибрати з гри
  // означає active = false у JSON (docs/db-schema.md §7).
  for (const key of diff.extra.slice(0, 10)) console.log(`  ! ${key} — є в базі, немає в JSON`);
  if (diff.extra.length > 10) console.log(`  ! … ще ${diff.extra.length - 10}`);
}

function diffRows(rows, dbRows, columns, key) {
  const byKey = new Map(dbRows.map((r) => [String(r[key]), r]));
  const diff = { added: [], changed: [], unchanged: 0, extra: [] };
  for (const row of rows) {
    const natural = String(row[key]);
    const current = byKey.get(natural);
    byKey.delete(natural);
    if (!current) { diff.added.push({ ...row, __key: natural }); continue; }
    const fields = columns
      .filter((c) => c !== key)
      .map((c) => ({ name: c, from: current[c], to: row[c] }))
      .filter((f) => !same(normalize(f.from), normalize(f.to)));
    if (fields.length) diff.changed.push({ key: natural, row, fields });
    else diff.unchanged++;
  }
  diff.extra = [...byKey.keys()];
  return diff;
}

// numeric із бази приходить рядком, jsonb — обʼєктом, і ключі в ньому
// Postgres тримає у своєму порядку. Тому перед звіркою і числа зводимо до
// чисел, і обʼєкти — до сортованих ключів: інакше кожен прогін показував
// би «змінено» на рівному місці.
const normalize = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v).sort().map((k) => [k, normalize(v[k])])
    );
  }
  return v;
};

// ── робота з базою ───────────────────────────────────────────────────────
const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`підозріла назва: ${name}`);
  return `"${name}"`;
};

async function selectAll(sql, table, columns) {
  const cols = columns.map(ident).join(", ");
  return await sql.unsafe(`select ${cols} from ${ident(table)}`);
}

async function upsert(sql, table, columns, key, rows) {
  const updatable = columns.filter((c) => c !== key);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const sets = updatable.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
  const text = `insert into ${ident(table)} (${columns.map(ident).join(", ")})
                values (${placeholders})
                on conflict (${ident(key)}) do update set ${sets}`;
  for (const row of rows) {
    await sql.unsafe(text, columns.map((c) => (row[c] === undefined ? null : row[c])));
  }
}

// ── pull ─────────────────────────────────────────────────────────────────
async function pull(sql) {
  for (const [table, spec] of tables) {
    const rows = await selectAll(sql, table, spec.columns);
    rows.sort((a, b) => (String(a[spec.key]) < String(b[spec.key]) ? -1 : 1));
    const out = rows.map((r) => Object.fromEntries(spec.columns.map((c) => [c, toJson(r[c])])));
    writeFileSync(path.join(SEEDS, `${table}.json`), JSON.stringify(out, null, 2) + "\n");
    console.log(`✓ ${table}.json — ${out.length} рядків з оточення ${ENV}`);
  }
  console.log("\nдалі: git diff db/seeds");
}

// ── apply ────────────────────────────────────────────────────────────────
async function apply(sql) {
  const plan = [];
  for (const [table, spec] of tables) {
    if (spec.owner === "admin" && ENV !== "local" && !flag("force")) {
      console.log(`\n${table}: пропущено — власник «admin», а оточення ${ENV} (--force, щоб усе одно)`);
      continue;
    }
    const rows = readSeed(table, spec.columns, spec.key);
    if (rows === null) { console.log(`\n${table}: файла немає, пропускаю`); continue; }
    const dbRows = await selectAll(sql, table, spec.columns);
    const diff = diffRows(rows, dbRows, spec.columns, spec.key);
    report(table, diff);
    const write = [...diff.added.map((r) => { const { __key, ...rest } = r; return rest; }),
                   ...diff.changed.map((c) => c.row)];
    if (write.length) plan.push({ table, spec, rows: write });
  }

  if (!WRITE) {
    const n = plan.reduce((a, p) => a + p.rows.length, 0);
    console.log(`\n${n ? `${n} рядків готові до запису` : "писати нічого"} — це сухий прогін, додайте --apply`);
    return;
  }
  if (!plan.length) { console.log("\nнічого писати"); return; }

  await sql.begin(async (tx) => {
    for (const { table, spec, rows } of plan) await upsert(tx, table, spec.columns, spec.key, rows);
  });
  console.log(`\n✓ записано в оточення ${ENV}: ` +
    plan.map((p) => `${p.table} ${p.rows.length}`).join(", "));
}

// ── старт ────────────────────────────────────────────────────────────────
const sql = new SQL(databaseUrl());
try {
  console.log(`${MODE} · оточення ${ENV}${ONLY ? ` · таблиця ${ONLY}` : ""}`);
  if (MODE === "pull") await pull(sql); else await apply(sql);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.close();
}
