// Помилки адмінки — у GlitchTip, проєкт admin. Копія client/src/errors.js:
// спільного пакета у фронтендів немає, а тягнути файл через межу застосунку
// заради ста рядків — гірше за копію. Міняти — в обох.
//
// Свій мінімальний клієнт замість @sentry/react — з тієї ж причини, що й
// lib/errors.js на сервісах: потрібні рівно «що впало, де, після яких
// запитів», а SDK — це ще десятки кілобайтів у бандлі телефона. Протокол —
// envelope, як і там. Ключ — у рядку запиту, тіло — text/plain: так запит
// «простий» і браузер не робить preflight до збирача (так шле й SDK).
//
// Правила:
//   - збій відправки ніколи не стає збоєм застосунку;
//   - стеля подій на хвилину й без повторів тієї самої помилки: зациклений
//     рендер не має забити квоту проєкту;
//   - в адресу не потрапляють ні рядок запиту, ні фрагмент (там бувають
//     токени входу й бонусу), у користувача — лише id.

// Шлях без того, що робить кожну подію унікальною або несе секрет: id,
// токени посилань, рядок запиту.
export const normalizePath = (p) => String(p).split(/[?#]/)[0]
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
  .replace(/^\/(r|b)\/[^/]+/, "/$1/:token")
  .replace(/\/\d+(?=\/|$)/g, "/:n");

const MAX_PER_MINUTE = 10;
const CRUMBS = 30;

let dsn = null;
let app = "admin";
let user = null;
const scope = {};
const crumbs = [];
let sent = [];
const seen = new Set();

function parseDsn(raw) {
  try {
    const u = new URL(raw);
    const project = u.pathname.replace(/^\//, "");
    if (!u.username || !project) return null;
    return `${u.protocol}//${u.host}/api/${project}/envelope/?sentry_key=${u.username}&sentry_version=7&sentry_client=extrovert-web%2F1`;
  } catch {
    return null;
  }
}

// Стек браузера → кадри Sentry. Chrome: «at fn (url:1:2)», Safari й
// Firefox: «fn@url:1:2». Порядок обернений: у Sentry перший кадр — найстаріший.
function frames(stack) {
  const out = [];
  for (const line of String(stack ?? "").split("\n")) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/) ?? line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    if (!m) continue;
    out.push({ function: m[1] || "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: m[2].startsWith(location.origin) });
  }
  return out.reverse();
}

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

function allowed(key) {
  const now = Date.now();
  sent = sent.filter((t) => now - t < 60_000);
  if (sent.length >= MAX_PER_MINUTE || seen.has(key)) return false;
  sent.push(now);
  seen.add(key);
  return true;
}

/** Слід перед помилкою: запит до api, перехід між екранами. */
export function breadcrumb(category, message, data) {
  crumbs.push({ timestamp: Date.now() / 1000, category, message, data });
  if (crumbs.length > CRUMBS) crumbs.shift();
}

/** Хто зараз у застосунку — лише id, без пошти й ніка. */
export function setErrorUser(id) { user = id ? { id } : null; }

/** Теги, що описують «де»: екран, вкладка. */
export function setErrorScope(next) { Object.assign(scope, next); }

/** Відправити помилку. Нічого не кидає й нічого не чекає. */
export function captureError(err, { level = "error", tags, extra } = {}) {
  if (!dsn) return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  if (!allowed(`${e.name}:${e.message}`)) return;
  const id = hex(16);
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level,
    logger: app,
    environment: import.meta.env.MODE === "production" ? "production" : "local",
    release: import.meta.env.VITE_RELEASE || undefined,
    user: user ?? undefined,
    request: { url: location.origin + normalizePath(location.pathname), headers: { "User-Agent": navigator.userAgent } },
    tags: { app, ...scope, ...(tags ?? {}) },
    extra: { online: navigator.onLine, viewport: `${innerWidth}x${innerHeight}`, ...(extra ?? {}) },
    breadcrumbs: { values: crumbs.slice() },
    exception: { values: [{ type: e.name || "Error", value: String(e.message ?? e), stacktrace: { frames: frames(e.stack) } }] },
  };
  const body = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  try {
    fetch(dsn, { method: "POST", body, keepalive: body.length < 60_000 }).catch(() => { /* збирач, що падає сам, — уже смішно */ });
  } catch { /* те саме */ }
}

/**
 * Підключити збір. Без DSN (локально, у превʼю) — нічого не робимо: у
 * GlitchTip має йти лише те, що бачать гравці.
 *
 * «Script error.» без стеку — це чужий скрипт (розширення браузера,
 * вбудований браузер месенджера), з нього нічого не дізнатись.
 */
export function initErrors(name) {
  app = name;
  dsn = parseDsn(import.meta.env.VITE_GLITCHTIP_DSN || "");
  if (!dsn) return false;
  window.addEventListener("error", (ev) => {
    if (!ev.error && /^Script error\.?$/.test(ev.message ?? "")) return;
    captureError(ev.error ?? new Error(ev.message), { tags: { kind: "onerror" } });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    // Обрив звʼязку вже показав тост і нічого не зламав — це не помилка коду.
    if (ev.reason?.offline) return;
    captureError(ev.reason, { tags: { kind: "unhandledrejection" } });
  });
  return true;
}
