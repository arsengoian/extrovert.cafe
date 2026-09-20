// Виклик моделі. Один тонкий адаптер, щоб решта коду не знала ні про
// Responses API, ні про назву моделі.
//
// Без ключа локально чат не мовчить, а відповідає уривком із бази знань і
// чесно позначає, що це офлайн-режим: так екран можна перевірити, і ніхто
// не сплутає заглушку з реальною відповіддю. У проді без ключа — помилка.
const ENDPOINT = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);

export const modelName = MODEL;
export const hasKey = () => Boolean(process.env.OPENAI_API_KEY);

function textFrom(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text);
  return parts.join("").trim();
}

export async function complete(messages, { maxTokens = 500 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no_api_key");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: messages, max_output_tokens: maxTokens }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return {
      text: textFrom(data),
      tokens_in: data.usage?.input_tokens ?? null,
      tokens_out: data.usage?.output_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Заглушка для локальної розробки: перший абзац найрелевантнішого документа.
export function offlineAnswer(knowledge) {
  const doc = knowledge[0]?.doc;
  if (!doc) return "Офлайн-режим: без ключа OpenAI я можу лише переказувати базу знань, а тут нічого не знайшлось.";
  const sentence = doc.body.split(". ").slice(0, 2).join(". ");
  return `${sentence}.\n\n(офлайн-режим: відповідь зібрана з бази знань, модель не викликалась)`;
}
