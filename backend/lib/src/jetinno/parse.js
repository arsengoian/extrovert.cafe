// Розбір сторінок порталу Jetinno — чисті функції, без мережі й залежностей.
// Одне джерело розмітки для серверного клієнта (portal.js) і для ручних
// скриптів (jetinno/scripts): портал рендерить таблиці на сервері, і колонки
// в них рахуються за позицією, тож цей розбір має бути один на всіх, щоб не
// розійтися (власник, 08.10.2026). Позиції колонок звірено з розміткою
// 08.10.2026: журнал команд — 21 колонка, напої — 13.

// Chromium — щоб серверні запити не вирізнялись від браузера оператора.
export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'" };
const cellText = (html) =>
  html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e).replace(/\s+/g, " ").trim();

// Рядки всіх <tbody> фрагмента — масиви текстів клітинок. Рядок «немає даних»
// має одну клітинку, тож відсівається перевіркою довжини у виклику.
export function tableRows(html) {
  const rows = [];
  for (const body of html.match(/<tbody[\s\S]*?<\/tbody>/gi) ?? []) {
    for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      rows.push((tr.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(cellText));
    }
  }
  return rows;
}

// Один <table> за id (портал кладе на сторінку кілька таблиць).
export function tableById(html, id) {
  const m = html.match(new RegExp(`<table[^>]*id="${id}"[\\s\\S]*?</table>`, "i"));
  return m ? m[0] : null;
}

// Напої зі звіту машини (/device_product після upload product).
export function parseProducts(html) {
  return tableRows(html)
    .filter((r) => r.length >= 13)
    .map((r) => ({
      productId: Number(r[3]),
      name: r[4],
      price: Number(r[5]),
      salePrice: Number(r[6]),
      discount: r[7],
      status: r[8],
      sort: Number(r[9]),
      uploaded: r[12],
    }));
}

// Журнал команд машині (/record_control), новіші першими. Колонку з логіном
// акаунта (r[1]) не беремо.
export function parseCommandLog(html) {
  return tableRows(html)
    .filter((r) => r.length >= 21)
    .map((r) => ({
      type: r[5], status: r[6], reason: r[7], dataType: r[10], productId: r[13],
      price: r[14], discount: r[15], created: r[18], updated: r[19], id: r[20],
    }));
}

// Несправності / попередження (/error): код, опис, тип, час, скидання.
export function parseFaults(html) {
  return tableRows(html)
    .filter((r) => r.length >= 8)
    .map((r) => ({ code: r[3], desc: r[4], kind: r[5], status: r[6], raised: r[7], cleared: r[8] }));
}

// Стан «відправлено» в журналі — ще не виконано машиною.
export const isPending = (status) => /надіслано|sent|发送/i.test(status ?? "");

// CSV експорту замовлень (/order?export=1): рядки з лапками, UTF-8. Повертає
// масив об'єктів за заголовком. Парсер простий, але тримає коми в лапках.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
