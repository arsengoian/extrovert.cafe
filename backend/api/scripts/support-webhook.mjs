// Стан і реєстрація вебхука бота підтримки.
//
//   bun run --filter @extrovert/api support:webhook            — показати, що бачить Telegram
//   bun run --filter @extrovert/api support:webhook --set      — зареєструвати на API_ORIGIN
//
// У проді api реєструє вебхук сам на старті, тож скрипт потрібен, коли щось
// пішло не так: подивитись last_error_message і перереєструвати. Токен і
// secret нікуди не друкуються.
import { bot, call, ensureWebhook, webhookUrl } from "../src/support/telegram.js";

const { token, username, secret } = bot();
if (!token) {
  console.error("SUPPORT_BOT_TOKEN не заданий — див. .env.example, розділ «Бот підтримки»");
  process.exit(1);
}

const me = await call("getMe");
console.log(`бот: @${me.username}${username && username !== me.username ? ` (увага: SUPPORT_BOT_USERNAME=${username})` : ""}`);

if (process.argv.includes("--set")) {
  if (!secret) {
    console.error("SUPPORT_BOT_SECRET не заданий: без нього вебхук приймав би будь-кого");
    process.exit(1);
  }
  const r = await ensureWebhook({ force: true });
  console.log(`зареєстровано: ${r.url}`);
}

const info = await call("getWebhookInfo");
console.log(`вебхук: ${info.url || "(немає)"}${info.url && info.url !== webhookUrl() ? `  ≠ очікуваний ${webhookUrl()}` : ""}`);
console.log(`у черзі оновлень: ${info.pending_update_count ?? 0}`);
if (info.last_error_date) {
  console.log(`остання помилка: ${new Date(info.last_error_date * 1000).toISOString()} — ${info.last_error_message}`);
}
