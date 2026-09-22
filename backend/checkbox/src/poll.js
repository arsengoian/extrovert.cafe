// Опитування чеків: вебхук може не дійти, тому раз на хвилину питаємо
// Checkbox самі (docs/checkbox.md, «Наш приймач»).
//
// Курсор зсувається назад на десять хвилин перекриття: краще перечитати ті
// самі чеки (їх відкине унікальний ключ), ніж загубити той, що прийшов із
// затримкою фіскалізації.
import { readCursor, writeCursor } from "@extrovert/lib/jobs.js";
import { pool } from "@extrovert/lib/db.js";
import { cashierToken } from "./cashier.js";
import { ingest } from "./receipts.js";

const API = process.env.CHECKBOX_API || "https://api.checkbox.ua";
const OVERLAP_MS = 10 * 60_000;
const PAGE = 100;
const CURSOR = "checkbox-receipts";

// Токен касира — у cashier.js: там же правило, що чеки створює лише
// тестовий касир. Опитування — читання, тож write не потрібен.
export async function pollReceipts({ log }) {
  const auth = await cashierToken({ log });
  if (!auth) return {};                     // без логіна касира просто не працюємо

  const cursor = await readCursor(pool, CURSOR);
  const from = new Date((cursor?.cursor_at ? new Date(cursor.cursor_at).getTime() : Date.now() - 24 * 3600_000) - OVERLAP_MS);
  const to = new Date();

  try {
    let offset = 0;
    let taken = 0;
    let fresh = 0;
    for (;;) {
      const url = new URL(`${API}/api/v1/receipts/search`);
      url.searchParams.set("from_date", from.toISOString());
      url.searchParams.set("to_date", to.toISOString());
      // Термінал продає під своїм касиром, а не під нашим токеном — без
      // self_receipts=false ми побачимо порожньо (docs/checkbox.md).
      url.searchParams.set("self_receipts", "false");
      url.searchParams.set("limit", String(PAGE));
      url.searchParams.set("offset", String(offset));

      const res = await fetch(url, { headers: { authorization: `Bearer ${auth}` } });
      if (res.status === 401) { token = null; throw new Error("токен касира протух"); }
      if (!res.ok) throw new Error(`receipts/search: HTTP ${res.status}`);
      const data = await res.json();
      const list = data.results ?? [];

      for (const receipt of list) {
        const { duplicate } = await ingest(receipt, { source: "poll", log });
        taken += 1;
        if (!duplicate) fresh += 1;
      }
      if (list.length < PAGE) break;
      offset += PAGE;
    }

    await writeCursor(pool, CURSOR, { cursorAt: to });
    return fresh ? { done: `нових чеків: ${fresh} з ${taken}` } : {};
  } catch (e) {
    log?.error("опитування чеків не вдалось", e);
    await writeCursor(pool, CURSOR, { error: e.message });
    return {};
  }
}
