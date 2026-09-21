// Клієнт mono pay (еквайринг Монобанку).
//
// Дві речі, які тут важливі й неочевидні:
//
//   1. **Суми — копійки.** В API mono все в мінімальних одиницях; гривні
//      перетворюємо рівно тут, як і з Checkbox (db-schema §0).
//   2. **Вебхук підписаний ECDSA**, а публічний ключ треба спершу
//      запитати в mono й кешувати. Без перевірки підпису будь-хто зміг би
//      надіслати нам «оплачено» і взяти монети безкоштовно.
import { createPublicKey, createVerify } from "node:crypto";

const API = process.env.MONO_API || "https://api.monobank.ua";
const TIMEOUT_MS = Number(process.env.MONO_TIMEOUT_MS || 15000);

export const hasToken = () => Boolean(process.env.MONO_TOKEN);

// Статуси mono → наші. «hold» для нас те саме, що processing: гроші ще не
// наші, монети не нараховуємо.
export const STATUS = {
  created: "created",
  processing: "processing",
  hold: "processing",
  success: "success",
  failure: "failure",
  reversed: "reversed",
  expired: "expired",
};

async function call(path, { method = "GET", body = null } = {}) {
  const token = process.env.MONO_TOKEN;
  if (!token) throw new Error("no_mono_token");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "X-Token": token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mono ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

// Рахунок на оплату. reference — наш id платежу: він повертається у
// вебхуці, і саме за ним ми знаходимо, кому нараховувати.
export async function createInvoice({ amountUah, reference, destination, redirectUrl, webHookUrl, basket }) {
  const data = await call("/api/merchant/invoice/create", {
    method: "POST",
    body: {
      amount: Math.round(Number(amountUah) * 100),
      ccy: 980,                                   // гривня
      merchantPaymInfo: {
        reference,
        destination,
        ...(basket ? { basketOrder: basket } : {}),
      },
      redirectUrl,
      webHookUrl,
      // Півгодини: за цей час людина або платить, або передумує, а
      // «висячий» рахунок на добу лише плутає й нас, і банк.
      validity: 30 * 60,
      paymentType: "debit",
    },
  });
  return { invoiceId: data.invoiceId, pageUrl: data.pageUrl };
}

export async function invoiceStatus(invoiceId) {
  const data = await call(`/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`);
  return { ...data, status: STATUS[data.status] ?? "processing" };
}

// Публічний ключ для перевірки підпису вебхука. Кешуємо: mono сам радить
// не смикати цей роут на кожен запит, але й тримати вічно не можна — ключ
// колись ротують, тому перезапитуємо раз на годину.
let pubkey = null;
let pubkeyAt = 0;
const PUBKEY_TTL_MS = 60 * 60 * 1000;

export async function publicKey() {
  if (pubkey && Date.now() - pubkeyAt < PUBKEY_TTL_MS) return pubkey;
  const data = await call("/api/merchant/pubkey");
  pubkey = createPublicKey(Buffer.from(data.key, "base64").toString("utf8"));
  pubkeyAt = Date.now();
  return pubkey;
}

// Підпис — ECDSA SHA-256 від сирого тіла, у base64, у заголовку X-Sign.
export async function verifyWebhook(rawBody, signature) {
  if (!signature) return false;
  try {
    const key = await publicKey();
    return createVerify("SHA256").update(rawBody, "utf8").verify(key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
