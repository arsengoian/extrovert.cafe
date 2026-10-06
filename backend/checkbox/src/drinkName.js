// Запасний пошук напою за назвою з чека — костиль (власник, 06.10.2026).
//
// Напій має визначати код позиції: «літера машини + номер», як у каталозі
// (docs/checkbox.md). Але автомат kyiv-01 шле в Checkbox «вільний товар» з
// кодом просто «a» — у телеметрії Jetinno коди позицій ще не заведені. Без
// цього пошуку кожен чек ішов із нулем монет. Коли коди в Jetinno з'являться,
// за кодом знаходитиметься все, і сюди ніхто не дійде.
//
// Назви в кав'ярні бувають неточні на кілька символів, тож шукаємо не
// рівність, а найближчу назву за кількістю правок (Левенштейн) — з допуском,
// що росте з довжиною. Пастка, яку це мусить обходити: «Еспресо з молоком» не
// можна прийняти за «Еспресо». Між ними десять правок, а допуск — щонайбільше
// три, тож відстань сама розводить такі пари. Якщо дві назви однаково близькі,
// напій не вгадуємо: краще нуль монет і попередження в лозі, ніж чужий напій.

export const normName = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[ʼ'’`]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

export function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Скільки правок прощаємо: у «Лате» одна вже багато, у «Американо з молоком»
// три — ще та сама назва.
export const allowedEdits = (len) => (len <= 5 ? 1 : len <= 10 ? 2 : 3);

// Скорочення з таблички автомата: «Еспресо з мол.» — та сама кількість
// слів, і кожне слово з чека є початком відповідного слова назви (обрізане
// — щонайменше з трьох літер). Кількість слів і розводить пастку: «Еспресо»
// одним словом не стане «Еспресо з молоком» трьома.
function abbreviates(want, full) {
  const a = want.split(" "), b = full.split(" ");
  if (a.length !== b.length) return false;
  return a.every((w, i) => w === b[i] || (w.length >= 3 && b[i].startsWith(w)));
}

// drinks — [{ slot, name }]. Повертає { slot, name, dist } або null
// (dist: кількість правок; для скорочення — -1).
export function pickDrinkByName(name, drinks) {
  const want = normName(name);
  if (!want) return null;
  const scored = drinks
    .map((d) => ({ slot: d.slot, name: d.name, norm: normName(d.name) }))
    .filter((d) => d.norm)
    .map((d) => ({ ...d, dist: editDistance(want, d.norm) }))
    .sort((a, b) => a.dist - b.dist);
  const [best, second] = scored;
  if (!best) return null;
  if (best.dist <= allowedEdits(Math.max(want.length, best.norm.length))) {
    if (second && second.dist === best.dist) return null;
    return { slot: best.slot, name: best.name, dist: best.dist };
  }
  const abbr = scored.filter((d) => abbreviates(want, d.norm));
  return abbr.length === 1 ? { slot: abbr[0].slot, name: abbr[0].name, dist: -1 } : null;
}
