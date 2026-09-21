// Відправка в Telegram. Без токена сервіс не падає, а пише в лог: локально
// бота немає, і це нормальний режим розробки.
const API = "https://api.telegram.org";

export async function send(text, { log } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    log?.info("telegram (без токена, лише лог)", { text });
    return false;
  }
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  } catch (e) {
    log?.error("telegram не прийняв повідомлення", e);
    return false;
  }
}
