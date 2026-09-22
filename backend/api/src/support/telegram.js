// Bot API для бота підтримки (docs/services.md, «Підтримка через Telegram»).
// Це окремий бот, не той, що пише алерти overseer-а: у цей пишуть гравці, і
// змішувати їхні розмови з тривогами сервера не можна.
//
// Без токена бот просто неактивний: посилання з кнопки «Підтримка» працює,
// якщо відомий username, а відповідати з адмінки нема чим — це нормальний
// режим локальної розробки.
const API = "https://api.telegram.org";

export const bot = () => ({
  token: process.env.SUPPORT_BOT_TOKEN || "",
  username: (process.env.SUPPORT_BOT_USERNAME || "").replace(/^@/, ""),
  secret: process.env.SUPPORT_BOT_SECRET || "",
});

export class TelegramError extends Error {
  constructor(method, status, description) {
    super(`telegram ${method}: ${status} ${description ?? ""}`.trim());
    this.status = status;
  }
}

export async function call(method, body) {
  const { token } = bot();
  if (!token) throw new TelegramError(method, 503, "no token");
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new TelegramError(method, res.status, data.description);
  return data.result;
}

export const sendMessage = (chatId, text) =>
  call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });

// Вкладення не качаємо заздалегідь: file_id лежить у базі, а файл тягнемо,
// лише коли адмін відкрив тред (посилання Bot API на файл живе годину).
export async function download(fileId) {
  const { token } = bot();
  const file = await call("getFile", { file_id: fileId });
  const res = await fetch(`${API}/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new TelegramError("file", res.status);
  return { res, path: file.file_path };
}

// Адреса вебхука збирається з API_ORIGIN, як і вебхук mono.
export const webhookUrl = () =>
  `${(process.env.API_ORIGIN || "https://api.extrovert.cafe").replace(/\/$/, "")}/api/v1/webhook/telegram/support`;

// Реєстрація вебхука ідемпотентна: якщо Telegram уже шле туди, куди треба,
// нічого не міняємо. Викликається на старті api в проді й скриптом
// `support:webhook` — вручну вона не потрібна.
export async function ensureWebhook({ log, force = false } = {}) {
  const { token, secret } = bot();
  if (!token || !secret) return { skipped: "no token or secret" };
  const url = webhookUrl();
  const info = await call("getWebhookInfo");
  if (!force && info.url === url) return { ok: true, url, unchanged: true, pending: info.pending_update_count };
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message"],
    drop_pending_updates: false,
  });
  log?.info({ url }, "вебхук бота підтримки зареєстровано");
  return { ok: true, url };
}
