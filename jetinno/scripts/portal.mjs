// Спільне для скриптів порталу Jetinno (docs/jetinno.md): сесія з куки,
// запити й розбір таблиць, які портал рендерить на сервері.
//
// Кука — з jetinno/cookie.txt (поза git): портал пускає за сесійною
// httpOnly-кукою, а вхід — із капчею, тож сесію бере людина зі свого
// браузера (як — написано в самому файлі).
import { readFileSync } from "node:fs";

export const BASE = "https://saas.jetinno.com";
export const VMC = process.env.JETINNO_VMC || "206946"; // kyiv-01
export const MENU_URL = process.env.MENU_URL || "https://pos.extrovert.cafe/points/kyiv-01/menu.json";

const COOKIE_FILE = new URL("../cookie.txt", import.meta.url);

function cookie() {
  let text = "";
  try { text = readFileSync(COOKIE_FILE, "utf8"); } catch { /* немає файла */ }
  const value = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).join(" ")
    .replace(/^\s*cookie:\s*/i, "").trim();
  if (!value) die("немає куки: встав її в jetinno/cookie.txt (інструкція всередині файла)");
  return value;
}

export function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// Злетіла сесія — портал редиректить на /login, і замість таблиці чи JSON
// приходить сторінка входу.
function checkSession(res, text) {
  if (new URL(res.url).pathname.startsWith("/login") || text.includes("/dologin")) {
    die("сесія злетіла: увійди в портал у браузері й встав нову куку в jetinno/cookie.txt");
  }
}

const headers = () => ({ cookie: cookie(), "user-agent": "Mozilla/5.0 extrovert-jetinno-scripts" });

export async function get(path) {
  const res = await fetch(BASE + path, { headers: headers() });
  const text = await res.text();
  checkSession(res, text);
  if (!res.ok) die(`GET ${path} → ${res.status}`);
  return text;
}

// AJAX-ендпоінти порталу: POST form-urlencoded, у відповідь JSON.
export async function post(path, data = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
    body: new URLSearchParams(data),
  });
  const text = await res.text();
  checkSession(res, text);
  if (!res.ok) die(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { die(`POST ${path}: не JSON — ${text.slice(0, 200)}`); }
}

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const cellText = (html) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e).replace(/\s+/g, " ").trim();

// Рядки всіх <tbody> сторінки — масиви текстів клітинок. Рядок «немає
// даних» має одну клітинку, тож відсіюється перевіркою довжини у виклику.
export function tableRows(html) {
  const rows = [];
  for (const body of html.match(/<tbody[\s\S]*?<\/tbody>/gi) ?? []) {
    for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      rows.push((tr.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(cellText));
    }
  }
  return rows;
}

// Команда машині: POST console_<route> з тим самим об'єктом, який шле
// сторінка (remote у device_info.js); порожні поля — порожні, як у jQuery.
export function command(route, fields = {}) {
  return post(`/console_${route}`, {
    routes: route, vmc_no: VMC, package: "", uptype: "", product_id: "", product_price: "",
    discount: "", storage: "0", date: "", folder: "", product_ids: "", ...fields,
  });
}

// Журнал команд машини, новіші першими. Колонку з логіном акаунта не
// беремо: у виводі вона нікому не потрібна.
export async function commandLog(limit = 10) {
  const html = await get(`/record_control?vmc_no=${VMC}&perPage=${limit}&page=1`);
  return tableRows(html).filter((r) => r.length >= 21).map((r) => ({
    type: r[5], status: r[6], reason: r[7], dataType: r[10], productId: r[13], price: r[14],
    discount: r[15], created: r[18], updated: r[19], id: r[20],
  }));
}

// Напої, як їх востаннє звітувала машина (після upload з uptype=product).
export async function machineProducts() {
  const html = await get(`/device_product?vmc_no=${VMC}&perPage=100&page=1`);
  return tableRows(html).filter((r) => r.length >= 13).map((r) => ({
    productId: Number(r[3]), name: r[4], price: Number(r[5]), salePrice: Number(r[6]), discount: r[7],
    status: r[8], sort: Number(r[9]), uploaded: r[12],
  }));
}

// Наше меню точки з публічного бакета: код позиції «a033» → product_id 33.
export async function menuDrinks() {
  const res = await fetch(MENU_URL);
  if (!res.ok) return [];
  const menu = await res.json();
  return (menu.drinks ?? []).map((d) => ({
    productId: Number(String(d.system_code).replace(/^[a-z]+/i, "")),
    name: d.name,
    price: Number(d.price_full ?? d.price),
  }));
}

// Стан команди ще «відправлено», а не виконано (мова — як у сесії куки).
export const isPending = (status) => /надіслано|sent|发送/i.test(status ?? "");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Надіслати команду й стежити за журналом, доки машина не відповість.
// «success» від порталу означає лише «відправлено» (docs/jetinno.md), тож
// правда — новий рядок журналу і його стан.
export async function sendAndWatch(route, fields, { timeoutS = 90 } = {}) {
  const before = new Set((await commandLog(20)).map((c) => c.id));
  const t0 = Date.now();
  const res = await command(route, fields);
  console.log(`портал: ${JSON.stringify(res)}`);
  if (res.status !== "success") die("портал команду не прийняв");
  let last = "";
  while (Date.now() - t0 < timeoutS * 1000) {
    await sleep(3000);
    const mine = (await commandLog(20)).find((c) => !before.has(c.id));
    if (!mine) continue;
    const line = `${mine.status}${mine.reason && mine.reason !== "--" ? ` (${mine.reason})` : ""}`;
    if (line !== last) { console.log(`  ${Math.round((Date.now() - t0) / 1000)} с: ${line}`); last = line; }
    if (!isPending(mine.status)) return mine;
  }
  console.log(`  за ${timeoutS} с машина не відповіла — подивись пізніше: bun jetinno/scripts/log.mjs`);
  return null;
}
