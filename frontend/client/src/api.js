// Тонкий клієнт до api. Access-токен живе в памʼяті й у localStorage, а
// refresh — httpOnly-кука, яку ставить сервер (docs/services.md §3).
// Токен короткий (15 хв), тож 401 — це нормальна подія, а не помилка:
// один раз міняємо куку на новий токен і повторюємо запит.
//
// Вихід з акаунта — лише тоді, коли сервер сказав «сесії немає» (401 на
// refresh). Обрив мережі чи api, що перезапускається під час деплою, — не
// привід викидати людину: токен і кука лишаються, запит просто падає.
import { breadcrumb, normalizePath } from "./errors.js";

const BASE = import.meta.env.VITE_API ?? "/api/v1";
const TOKEN_KEY = "extrovert.token";

let token = localStorage.getItem(TOKEN_KEY) || null;
let refreshing = null;              // спільна обіцянка: паралельні 401 чекають одну

// Останні відповіді GET за шляхом. Вкладки й екрани розмонтовуються при
// кожному переході, і кожен приходив зі скелетом, а за мить дані
// розсували його — «розділ відкривається до того, як усе промальовується»
// (власник, 26.09.2026). Тепер екран, куди повертаються, починає з
// попередньої відповіді (api.peek), а свіжа заміняє її на місці —
// здебільшого без жодної різниці на око. Лише в памʼяті сторінки:
// перезавантаження чи вихід з акаунта — і тут порожньо.
const recent = new Map();

export const getToken = () => token;
export function setToken(next) {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else { localStorage.removeItem(TOKEN_KEY); recent.clear(); }   // чужі дані наступному не показуємо
}

// Токен, придатний просто зараз. Потрібен там, де 401 не допоможе: ws
// перевіряє токен один раз, під час рукостискання, і протухлий просто
// відхиляє — повторити запит, як це робить request(), там нікому.
// Тридцять секунд запасу: рівно стільки може зайняти саме зʼєднання.
export async function ensureToken() {
  const claims = token && (() => {
    try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch { return null; }
  })();
  if (token && (!claims?.exp || claims.exp > Date.now() / 1000 + 30)) return token;
  try {
    await refresh();
  } catch {
    return null;
  }
  return token;
}

// Текст для людини за кодом відповіді api. Сервер відповідає лише кодом
// ({ error: "item_locked" }), і досі цей код у десятках місць ішов на екран
// як є: «not_active» у картці кавенятка, «item_locked» під кнопкою
// (03.10.2026). Тепер повідомлення помилки — завжди українською, а код
// лишається в e.body.error для гілок, що на нього реагують по-своєму.
const ERROR_TEXT = {
  already_gone: "Цей лот уже купили",
  not_active: "Лот уже неактивний – можливо, його щойно купили",
  no_such_listing: "Лот уже неактивний – можливо, його щойно купили",
  own_listing: "Свій лот купити не можна",
  already_listed: "Уже виставлено на продаж",
  not_for_sale: "Це не продається",
  bad_price: "Перевір ціну",
  price_too_low: "Ціна замала",
  bad_amount: "Перевір кількість",
  not_enough: "Не вистачає на рахунку",
  not_enough_coins: "Не вистачає монет",
  no_supply: "Препарат закінчився",
  on_sale: "Кавенятко зараз на продажу",
  no_such_plant: "Цього кавенятка вже немає – можливо, воно в іншого власника",
  last_plant: "Це твоє єдине кавенятко",
  not_grown: "Кавенятко ще не доросле",
  fully_grown: "Кавенятко вже доросле",
  mood: "Спершу полий кавенятко",
  too_soon: "Ще зарано – приходь трохи згодом",
  water_too_soon: "Кавенятко вже попило – приходь трохи згодом",
  wrong_care: "Кавенятко хоче іншого",
  needs_planting: "Спершу посади",
  nothing_to_plant: "Нічого садити",
  no_such_item: "Цього предмета вже немає",
  item_locked: "Предмет заморожений: він на продажу або в комплекті",
  item_in_set: "Предмет подаровано кавенятку разом із комплектом",
  item_on_market: "Предмет зараз на продажу",
  wrong_slot: "Цей предмет – для іншого слоту",
  no_set: "Повного комплекту ще немає",
  no_crates: "Скриньок немає",
  no_such_user: "Такого нікнейма не знайдено",
  self_transfer: "Собі переказати не можна",
  self_gift: "Собі подарувати не можна",
  nickname_taken: "Цей нікнейм уже зайнятий",
  bad_nickname: "Нікнейм – 3–24 букви, цифри, _ або -",
  bad_name: "Перевір ім'я",
  empty_name: "Вкажи ім'я",
  too_long: "Задовгий текст",
  empty_message: "Напиши хоч щось",
  confirm_required: "Підтверди дію",
  size_required: "Обери розмір",
  city_required: "Обери місто",
  warehouse_required: "Обери відділення Нової Пошти",
  no_such_warehouse: "Такого відділення не знайдено",
  bad_phone: "Перевір номер телефону",
  plant_required: "Обери кавенятко",
  point_required: "Обери точку",
  no_print: "Принт ще не готовий",
  not_available: "Зараз це недоступно",
  payments_not_connected: "Оплата тимчасово недоступна",
  support_not_connected: "Підтримка тимчасово недоступна",
  too_many: "Забагато спроб – спробуй трохи згодом",
  too_many_uploads: "Забагато фото поспіль – спробуй за годину",
  too_big: "Файл завеликий",
  bad_type: "Цей формат не підходить",
  link_expired: "Посилання застаріло – надішли нове",
  mail_failed: "Лист не відправився – спробуй ще раз",
  already_done: "Уже зроблено",
  already_answered: "Відповідь уже є",
  incomplete: "Дай відповідь на всі питання",
  save_failed: "Не вдалось зберегти – спробуй ще раз",
};
export const humanError = (status, body) =>
  ERROR_TEXT[body?.error]
  ?? (status >= 500 || status === 0 ? "Сервер не відповів – спробуй ще раз за хвилину" : "Не вийшло – спробуй ще раз");

export class ApiError extends Error {
  constructor(status, body, offline = false) {
    super(offline ? "Немає звʼязку" : humanError(status, body));
    this.status = status;
    this.body = body;
    /* Запит не дійшов узагалі: мережі немає, api перезапускається, або
     * браузер відхилив його ще на preflight. Для екрана це не «помилка
     * операції», а «спробуй ще раз» — і каже це один тост на весь
     * застосунок, а не текст у тому місці, де натиснули (24.09.2026). */
    this.offline = offline;
  }
}

// Текст помилки для екрана. null — коли показувати нічого не треба: про
// обрив звʼязку вже сказав тост, і дублювати його блоком у пів-екрана
// означало б двічі лякати тим самим.
export const errText = (e) => (e?.offline ? null : e?.message ?? null);

async function refresh() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .catch(() => {
      // Той самий обрив, що й у send(): без цього TypeError із fetch
      // долітав до екрана повз ApiError.
      window.dispatchEvent(new CustomEvent("extrovert:offline"));
      throw new ApiError(0, null, true);
    })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const data = await res.json();
      setToken(data.token);
      return data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function send(path, { method, body, auth }) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth && token) headers.authorization = `Bearer ${token}`;
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch кидає TypeError і на вимкнений Wi-Fi, і на api, що
    // перезапускається, і на відхилений preflight — розрізнити їх із
    // браузера не можна, та й не треба: для людини це одне й те саме.
    // Раніше цей TypeError доходив до екрана як є, і в підказці під
    // кнопкою світилось «Failed to fetch» (24.09.2026).
    breadcrumb("fetch", `${method} ${normalizePath(path)} — немає звʼязку`);
    window.dispatchEvent(new CustomEvent("extrovert:offline"));
    throw new ApiError(0, null, true);
  }
}

async function request(path, { method = "GET", body, auth = true, retry = true } = {}) {
  let res = await send(path, { method, body, auth });

  if (res.status === 401 && auth && retry) {
    try {
      await refresh();
      res = await send(path, { method, body, auth });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      setToken(null);
    }
  }

  breadcrumb("fetch", `${method} ${normalizePath(path)} → ${res.status}`);
  // Не JSON — це сторінка помилки проксі (502 від Caddy чи Cloudflare під
  // час викочування). Раніше SyntaxError з JSON.parse летів до екрана
  // замість зрозумілого «HTTP 502».
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* лишаємо null */ }
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, data);
  }
  return data;
}

// Та сама зміна, що ще летить, — це подвійний тап, а не другий намір.
// Кнопки вимикаються через setBusy, але лише з наступним рендером, і два
// швидкі тапи встигали проскочити: три однакові скарги з одного «Надіслати»
// (і три алерти в Telegram), подвійне списання за полив чи покупку
// (03.10.2026). Тому вимикаємо тут, для всіх екранів одразу: дубль не
// йде в мережу, а отримує ту саму відповідь, що й перший запит.
//
// Саме ту саму, а не «ніколи»: ефект, що монтується вдруге посеред запиту
// (StrictMode у dev, зміна ключа екрана), інакше чекав би вічно — так
// застрягала анімація відкриття скриньки. Подвійний перехід від двох
// обробників ловить уже push() в app.jsx.
const inflight = new Map();
function once(method, path, body) {
  const key = `${method} ${path} ${body === undefined ? "" : JSON.stringify(body)}`;
  if (inflight.has(key)) return inflight.get(key);
  const pending = request(path, { method, body }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

export const api = {
  get: (path) => request(path).then((data) => { recent.set(path, data); return data; }),
  // Остання відповідь на цей GET або undefined — для початкового стану екрана.
  peek: (path) => recent.get(path),
  post: (path, body) => once("POST", path, body),
  patch: (path, body) => once("PATCH", path, body),
  put: (path, body) => once("PUT", path, body),
  del: (path) => once("DELETE", path),

  // Лист із посиланням для входу; next — куди повернутись після входу.
  emailLogin: (email, next) => request("/auth/email", { method: "POST", body: { email, next }, auth: false }),

  // Вкладка, що просила лист, чекає підтвердження (довгий запит, до 20 с):
  // сесія, { pending: true } або 410 — відхилили чи застаріло.
  emailWait: (wait) =>
    request("/auth/email/wait", { method: "POST", body: { wait }, auth: false }).then((r) => {
      if (r?.token) setToken(r.token);
      return r;
    }),
  // Посилання відкрили в іншому браузері: що саме підтверджуємо, і «ні, не я».
  emailPeek: (token) => request("/auth/email/peek", { method: "POST", body: { token }, auth: false }),
  emailReject: (token) => request("/auth/email/reject", { method: "POST", body: { token }, auth: false }),

  // Посилання з листа відкрите: токен із фрагмента міняємо на сесію.
  emailVerify: (token) =>
    request("/auth/email/verify", { method: "POST", body: { token }, auth: false }).then((r) => {
      setToken(r.token);
      return r;
    }),

  // Вхід через Google — не fetch, а перехід: Google має показати свій
  // екран і повернути людину назад на api, який поставить куку.
  googleLoginUrl: (next = "/") => `${BASE}/auth/google?next=${encodeURIComponent(next)}`,
  // Разом із токеном — і те, що належало саме цьому акаунту: обране
  // кавенятко й незавершений рахунок mono. Інакше наступний, хто увійде на
  // цьому пристрої, успадковував би чужі (03.10.2026). Тема й вкладка
  // Магазину — налаштування пристрою, їх лишаємо.
  logout: () => request("/auth/logout", { method: "POST", auth: false }).finally(() => {
    setToken(null);
    for (const key of ["extrovert.plant", "extrovert.pending_invoice"]) {
      try { localStorage.removeItem(key); } catch { /* приватний режим */ }
    }
  }),

  // Спроба підняти сесію без екрана входу: якщо кука жива, застосунок
  // відкриється одразу.
  restore: () => refresh().then((r) => r.user),
};
