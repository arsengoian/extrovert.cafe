// Серверний клієнт порталу Jetinno (docs/jetinno.md, «Скоуп інтеграції»).
// Один на всі звернення сервера: телеметрія, замовлення, деплой цін. Що він
// дає понад ручні скрипти:
//   * темп — спільна черга в Redis (limiter.js), ≤ JETINNO_MAX_RPS/с;
//   * сесія — у Redis (jetinno:session), живе від самих запитів;
//   * помилки — типовані (кидаємо), а не process.exit, як у скриптах.
//
// Розбір сторінок — спільний із скриптами (parse.js), щоб колонки не
// розійшлися. Портал — Laravel: сторінки й таблиці рендеряться на сервері,
// JSON дають лише AJAX-ендпоінти; CSRF не вимагає, сесія — httpOnly-кука.
import { redisClient } from "../redis.js";
import { rateLimiter } from "./limiter.js";
import { USER_AGENT, parseProducts, parseCommandLog, parseFaults, parseCsv, tableById, isPending } from "./parse.js";

export const SESSION_KEY = "jetinno:session";

// Сесія злетіла: портал редиректить на /login, і замість таблиці чи JSON
// приходить сторінка входу. Окремий тип — щоб робота могла відрізнити «треба
// новий вхід» від звичайного збою й покликати людину, а не падати мовчки.
export class JetinnoSessionError extends Error {
  constructor(msg = "сесія порталу Jetinno злетіла — потрібен новий вхід") {
    super(msg);
    this.name = "JetinnoSessionError";
  }
}

export function portalClient({ redis, env = process.env } = {}) {
  const client = redis ?? redisClient();
  const base = (env.JETINNO_BASE || "https://saas.jetinno.com").replace(/\/+$/, "");
  const throttle = rateLimiter({ redis: client });
  // Запобіжник: після серії редиректів на /login чи 5xx поспіль не довбаємо
  // портал, а віддаємо помилку роботі (чужий сайт, одна сесія оператора).
  let failStreak = 0;

  async function cookie() {
    const value = await client.get(SESSION_KEY);
    if (!value) throw new JetinnoSessionError("немає сесії порталу Jetinno — потрібен вхід");
    return value;
  }

  function checkSession(res, text) {
    if (new URL(res.url).pathname.startsWith("/login") || text.includes("/dologin")) {
      failStreak++;
      throw new JetinnoSessionError();
    }
  }

  // Кука мертва — один раз пробуємо перелогінитись і повторюємо запит. Але не
  // частіше разу на JETINNO_RELOGIN_MIN хвилин (типово 30): лок у Redis (NX +
  // TTL) спільний між процесами, тож навіть кілька робіт дадуть щонайбільше
  // один вхід на півгодини. Невдалий вхід теж тримає лок — не довбаємо портал
  // і не наближаємо блокування акаунта. Сам вхід кличе solveCaptcha власника.
  const RELOGIN_EVERY_MS = Number(env.JETINNO_RELOGIN_MIN || 30) * 60_000;
  async function tryRelogin() {
    const got = await client.set("jetinno:login:lock", Date.now(), "PX", RELOGIN_EVERY_MS, "NX");
    if (!got) return false;                         // входили нещодавно — чекаємо
    try { await login({ redis: client, env }); failStreak = 0; return true; }
    catch { return false; }
  }

  async function request(path, init = {}, relogged = false) {
    if (failStreak >= 5) throw new Error("портал Jetinno недоступний — зупинив запити до наступного проходу");
    await throttle();
    let ck;
    try {
      ck = await cookie();
    } catch (e) {
      if (e instanceof JetinnoSessionError && !relogged && await tryRelogin()) return request(path, init, true);
      throw e;
    }
    let res, text;
    try {
      res = await fetch(base + path, {
        ...init,
        redirect: "follow",
        headers: { cookie: ck, "user-agent": USER_AGENT, ...(init.headers ?? {}) },
      });
      text = await res.text();
    } catch (e) {
      failStreak++;
      throw e;
    }
    try {
      checkSession(res, text);
    } catch (e) {
      if (e instanceof JetinnoSessionError && !relogged && await tryRelogin()) return request(path, init, true);
      throw e;
    }
    if (res.status >= 500) { failStreak++; throw new Error(`Jetinno ${path} → ${res.status}`); }
    failStreak = 0;
    return { res, text };
  }

  async function get(path) {
    const { res, text } = await request(path);
    if (!res.ok) throw new Error(`Jetinno GET ${path} → ${res.status}`);
    return text;
  }

  // AJAX-ендпоінти: POST form-urlencoded → JSON. Команди машині теж тут.
  async function post(path, data = {}) {
    const { res, text } = await request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
      body: new URLSearchParams(data),
    });
    if (!res.ok) throw new Error(`Jetinno POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { throw new Error(`Jetinno POST ${path}: не JSON — ${text.slice(0, 200)}`); }
  }

  // ── Читання ──────────────────────────────────────────────────────────
  async function devices() {
    const { data = [] } = await post("/ajax/get_device", { sort: "is_connected" });
    return data;
  }
  async function device(vmc) {
    return (await devices()).find((d) => String(d.vmc_no) === String(vmc)) ?? null;
  }
  async function products(vmc) {
    return parseProducts(await get(`/device_product?vmc_no=${vmc}&perPage=100&page=1`));
  }
  async function commandLog(vmc, limit = 20) {
    return parseCommandLog(await get(`/record_control?vmc_no=${vmc}&perPage=${limit}&page=1`));
  }
  async function faults(vmc, { year = new Date().getFullYear() } = {}) {
    return parseFaults(await get(`/error?vmc_no=${vmc}&data_type=&is_set=&dateyear=${year}&perPage=1000&page=1`));
  }
  async function orders(vmc, month) {
    const csv = await get(`/order?vmc_no=${vmc}&datemonth=${month}&export=1`);
    return parseCsv(csv);
  }

  // ── Команда машині ───────────────────────────────────────────────────
  // POST console_<route> з тим самим об'єктом remote, що шле сторінка. Успіх
  // від порталу означає лише «відправлено» — виконання перевіряє викликач
  // (priceset машина в журналі не підтверджує: ack — перечитуванням напоїв).
  function command(route, vmc, fields = {}) {
    return post(`/console_${route}`, {
      routes: route, vmc_no: String(vmc), package: "", uptype: "", product_id: "", product_price: "",
      discount: "", storage: "0", date: "", folder: "", product_ids: "", ...fields,
    });
  }

  return { base, get, post, devices, device, products, commandLog, faults, orders, command };
}

// ── Сесія ────────────────────────────────────────────────────────────────
// Куку кладе сюди вхід (нижче) або людина вручну (поки вхід не автоматичний).
export async function setSession(redis, cookieHeader) {
  await redis.set(SESSION_KEY, cookieHeader);
}
export async function hasSession(redis) {
  return Boolean(await redis.get(SESSION_KEY));
}

// Набір Set-Cookie з відповіді → один заголовок Cookie («name=value; ...»).
function cookieFromSetCookie(arr) {
  return (arr ?? []).map((c) => c.split(";")[0]).filter((kv) => kv.includes("=")).join("; ");
}
// Нові Set-Cookie перекривають старі за іменем (Laravel на вході регенерує id).
function mergeCookie(oldCookie, setCookie) {
  const map = new Map();
  const put = (kv) => { const i = kv.indexOf("="); if (i > 0) map.set(kv.slice(0, i), kv.slice(i + 1)); };
  for (const part of (oldCookie || "").split("; ")) if (part) put(part);
  for (const c of setCookie ?? []) put(c.split(";")[0]);
  return [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}
// Портал розрізняє помилку капчі й помилку пароля (login-сторінка:
// trans_verification_error). На капчі — пробуємо ще з новою; на паролі —
// стоп одразу, щоб не наближати блокування акаунта за невірним паролем.
const isCaptchaError = (info) => /капч|captcha|verif|验证/i.test(info ?? "");

async function startSession(base) {
  const res = await fetch(`${base}/login`, { headers: { "user-agent": USER_AGENT } });
  await res.text();
  const cookie = cookieFromSetCookie(res.headers.getSetCookie?.());
  if (!cookie) throw new Error("портал не видав сесійної куки на /login");
  return cookie;
}
// Картинка капчі, прив'язана до сесії cookie, у base64 — у такому вигляді її
// очікує solveCaptcha.
async function fetchCaptcha(base, cookie) {
  const res = await fetch(`${base}/captcha/flat?${Date.now()}${Math.random()}`, {
    headers: { cookie, "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`капча: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}


async function solveCaptcha(captchaString){
    const response = await fetch(`http://ddddocr:8000/ocr`, {
        method: 'POST',
        body: `image=${encodeURIComponent(captchaString)}`
    })
    return response?.data ?? null;
}



// Вхід у портал і збереження сесії в Redis. Усе, крім розпізнавання капчі,
// робить ця функція: бере свіжу сесію з /login, тягне картинку капчі,
// віддає її в solveCaptcha, шле /dologin з логіном-паролем з .env.prod і
// кладе авторизовану куку в Redis (SESSION_KEY).
//
// solveCaptcha(base64Image) → рядок коду — реалізує власник (напр. OCR); тут
// її свідомо немає (капча — захист порталу від ботів). Без неї вхід не
// відбувається: або передай solveCaptcha, або постав куку в Redis вручну.
// Логін і пароль у логи й повідомлення не потрапляють.
export async function login({ redis, env = process.env, maxCaptchaTries = 5 } = {}) {
  const client = redis ?? redisClient();
  const base = (env.JETINNO_BASE || "https://saas.jetinno.com").replace(/\/+$/, "");
  const username = env.JETINNO_LOGIN;
  const password = env.JETINNO_PASSWORD;
  if (!username || !password) throw new Error("немає JETINNO_LOGIN / JETINNO_PASSWORD (.env.prod)");

  let cookie = await startSession(base);
  for (let attempt = 1; attempt <= maxCaptchaTries; attempt++) {
    const image = await fetchCaptcha(base, cookie);
    const code = String(await solveCaptcha(image)).trim();
    const res = await fetch(`${base}/dologin`, {
      method: "POST",
      headers: {
        cookie, "user-agent": USER_AGENT,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: new URLSearchParams({ username, password, code }),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const body = await res.json().catch(() => ({}));

    if (body.status === "success") {
      cookie = mergeCookie(cookie, setCookie);
      await client.set(SESSION_KEY, cookie);
      return { ok: true };
    }
    const denied = body.data?.username_denied;
    if (denied) throw new Error(`акаунт Jetinno заблоковано, спробуй через ~${denied.countdown ?? "?"} с`);
    // Не капча (пароль/логін чи інше) — не повторюємо: інакше серія невірних
    // паролів заблокує акаунт.
    if (!isCaptchaError(body.info)) throw new Error(`вхід Jetinno не вдався: ${body.info ?? "невідома помилка"}`);
  }
  throw new Error(`капчу не розпізнано за ${maxCaptchaTries} спроб — перевір solveCaptcha`);
}

export { isPending, tableById, fetchCaptcha };
