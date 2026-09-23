// Компоненти, які використані в JSX, але нізвідки не взялись.
//
// Збірка такого не ловить: для esbuild <Foo /> — це просто Foo, і помилка
// вилазить лише в браузері, коли екран малюється. 23.09.2026 так поїхав у
// прод онбординг без TopbarBack — нові користувачі бачили порожній екран.
//
//   bun scripts/check-jsx.mjs            # усі фронтенди
//   bun scripts/check-jsx.mjs frontend/client
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
const DIRS = roots.length ? roots : ["frontend/client/src", "frontend/admin/src"];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith(".jsx")) files.push(full);
  }
};
for (const d of DIRS) walk(d);

// Теги з великої літери — це компоненти; усе інше малює браузер сам.
const USED = /<([A-Z][A-Za-z0-9_]*)/g;
const DECLARED = /(?:function|const|let|class)\s+([A-Z][A-Za-z0-9_]*)/g;
const IMPORTED = /import\s+(?:([A-Z][A-Za-z0-9_]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g;

let bad = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const known = new Set(["Fragment"]);
  for (const m of src.matchAll(DECLARED)) known.add(m[1]);
  for (const m of src.matchAll(IMPORTED)) {
    if (m[1]) known.add(m[1]);
    for (const part of (m[2] ?? "").split(",")) {
      const name = part.split(" as ").pop().trim();
      if (name) known.add(name);
    }
  }
  const missing = [...new Set([...src.matchAll(USED)].map((m) => m[1]))]
    // Точкові теги (<I.health />) і локальні змінні в дужках не рахуємо.
    .filter((n) => !known.has(n) && !src.includes(`${n} =`) && !src.includes(`${n}:`));
  if (missing.length) {
    bad++;
    console.error(`✗ ${file}: ${missing.join(", ")}`);
  }
}
console.log(bad ? `\n${bad} файл(ів) із невизначеними компонентами` : `✓ ${files.length} файлів: усі компоненти визначені`);
process.exit(bad ? 1 : 0);
