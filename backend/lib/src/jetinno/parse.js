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
// >= 9, а не 8: читаємо r[8] (cleared), і 8-клітинковий рядок давав би
// cleared === undefined — тобто вже скинуту подію рахувало б як активну.
export function parseFaults(html) {
  return tableRows(html)
    .filter((r) => r.length >= 9)
    .map((r) => ({ code: r[3], desc: r[4], kind: r[5], status: r[6], raised: r[7], cleared: r[8] }));
}

// Команда в журналі ще не виконана машиною — визначаємо структурно, а не за
// текстом статусу. Портал проставляє `updated`, коли машина відзвітувала, тож
// у просто надісланої він дорівнює `created`. Текст перекладається разом із
// мовою сесії (uk «Надіслано» = de «Abwurf erfolgreich»), а мову портал
// обирає за IP на вході — 11.10.2026 прод зайшов у німецьку, і waitExecuted
// став вважати команду виконаною одразу, не дочекавшись машини. Мову ми все
// одно прибиваємо (portal.js, setLanguage), але логіка на неї не спирається.
export const isPendingRow = (row) => !row?.updated || row.updated === row.created;

// Колонки CSV замовлень (/order?export=1) — за позицією, а не за назвою
// заголовка: назви так само перекладаються («Тип оплати» = «Welche art Von
// zahlung»), і пошук за назвою мовчки давав порожнечу — machine_orders не
// наповнювались, а звірка в адмінці показувала «0 карткою / N чеків
// розходяться». Порядок колонок однаковий у всіх мовах (звірено uk і de,
// 11.10.2026).
export const ORDER_COL = {
  orderNo: 1, productId: 3, name: 4, price: 5, payType: 6, status: 7,
  purchasedAt: 12, uploadedAt: 13,
};

// CSV експорту замовлень (/order?export=1): рядки з лапками, UTF-8. Повертає
// матрицю — `header` і `rows` масивами, щоб читати за позицією (ORDER_COL), а
// не за перекладною назвою. Парсер простий, але тримає коми в лапках.
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
  if (!rows.length) return { header: [], rows: [] };
  return { header: rows[0], rows: rows.slice(1) };
}
