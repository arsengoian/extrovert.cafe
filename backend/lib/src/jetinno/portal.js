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

  async function request(path, init = {}) {
    if (failStreak >= 5) throw new Error("портал Jetinno недоступний — зупинив запити до наступного проходу");
    await throttle();
    const ck = await cookie();
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
    checkSession(res, text);
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

// Вхід у портал. Капчу портал вимагає на /dologin, тож повністю автоматично
// сервер увійти не може: `solveCaptcha(imageBuffer)` → рядок коду — це місце,
// куди підставляється розв'язувач. За замовчуванням його немає, і вхід
// повідомляє, що потрібна людина.
//
// TODO(Telegram): коли дозволимо — тут бот шле власнику картинку капчі
// (GET /captcha/flat) і чекає відповіді; поки свідомо не реалізовано, щоб не
// піднімати вебхук лише заради цього (власник, 09.10.2026). Логін і пароль —
// JETINNO_LOGIN / JETINNO_PASSWORD з .env.prod.
export async function login(/* { redis, env, solveCaptcha } */) {
  throw new Error(
    "автоматичний вхід у Jetinno ще не реалізовано (капча): постав куку сесії вручну в Redis " +
    `(${SESSION_KEY}) або дочекайся реалізації входу`
  );
}

export { isPending, tableById };
