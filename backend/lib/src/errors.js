// Помилки — в GlitchTip. Свій мінімальний клієнт замість @sentry/node, і це
// свідомо: SDK тягне OpenTelemetry з десятком пакетів і патчить рантайм, а
// нам потрібні рівно дві речі — «сталась ось така помилка» і стек. На
// сервісах під bun із лімітом 512 МБ це різниця між сотнею кілобайтів і
// десятками мегабайтів залежностей, які ще й доведеться тримати сумісними
// з bun (docs/services.md §4).
//
// Протокол — envelope: три рядки JSON у тілі POST. Формат стабільний із
// Sentry 9 і його ж розуміє GlitchTip.
//
// Правила, які тут важать більше за повноту:
//   - помилка відправки НІКОЛИ не стає помилкою застосунку (тихо ковтаємо);
//   - є стеля на хвилину: зациклений сервіс не має забити квоту проєкту й
//     не має перетворити чужий збій на свій DDoS;
//   - DSN не секрет (він лише каже, куди слати), тож живе просто в .env.
import { hostname } from "node:os";

const MAX_PER_MINUTE = Number(process.env.GLITCHTIP_MAX_PER_MINUTE || 20);
const TIMEOUT_MS = 5000;

let dsn = null;
let service = "unknown";
let sent = [];

function parseDsn(raw) {
  try {
    const u = new URL(raw);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      key: u.username,
    };
  } catch {
    return null;
  }
}

// Стек JS → кадри Sentry. Порядок обернений: там перший кадр — найстаріший.
function frames(stack) {
  const out = [];
  for (const line of String(stack ?? "").split("\n").slice(1)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2];
    out.push({
      function: m[1] ?? "?",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return out.reverse();
}

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");

function allowed() {
  const now = Date.now();
  sent = sent.filter((t) => now - t < 60_000);
  if (sent.length >= MAX_PER_MINUTE) return false;
  sent.push(now);
  return true;
}

/** Відправити помилку. Нічого не кидає й нічого не чекає. */
export function captureError(err, context = {}) {
  if (!dsn || !allowed()) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const body = [
    JSON.stringify({ event_id: hex(16), sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: hex(16),
      timestamp: Date.now() / 1000,
      platform: "node",
      level: context.level ?? "error",
      logger: service,
      server_name: hostname(),
      environment: process.env.APP_ENV || "local",
      release: process.env.TAG || undefined,
      tags: { service, ...(context.tags ?? {}) },
      extra: context.extra ?? undefined,
      exception: {
        values: [{
          type: e.name || "Error",
          value: String(e.message ?? e),
          stacktrace: { frames: frames(e.stack) },
        }],
      },
    }),
  ].join("\n");

  fetch(dsn.url, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=extrovert/1`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => { /* збирач помилок, що падає сам, — це вже смішно */ });
}

/**
 * Підключити збір для сервіса. DSN шукається як GLITCHTIP_DSN_<ІМʼЯ>, і лише
 * потім як спільний GLITCHTIP_DSN: у всіх сервісів один .env, і без імені в
 * змінній усі писали б в один проєкт.
 *
 * Ловимо й те, що взагалі не має статись: необроблену обіцянку й виняток
 * поза обробником. Процес після uncaughtException не рятуємо — докер
 * підніме, — але встигаємо сказати, від чого він помер.
 */
export function initErrors(name, { log } = {}) {
  service = name;
  const key = `GLITCHTIP_DSN_${name.toUpperCase().replace(/-/g, "_")}`;
  dsn = parseDsn(process.env[key] || process.env.GLITCHTIP_DSN || "");
  if (!dsn) return false;

  process.on("unhandledRejection", (reason) => {
    log?.error("необроблена обіцянка", reason);
    captureError(reason, { tags: { kind: "unhandledRejection" } });
  });
  process.on("uncaughtException", (e) => {
    log?.error("виняток поза обробником", e);
    captureError(e, { tags: { kind: "uncaughtException" }, level: "fatal" });
  });
  log?.info("помилки йдуть у glitchtip", { project: name });
  return true;
}
