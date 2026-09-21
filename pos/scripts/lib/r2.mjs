// Заливка меню й релізів у R2. Підпис і вибір бакета живуть у спільному
// @extrovert/lib/r2.js — тут лишилась сумісна обгортка put(env, {...}),
// яку викликають два скрипти поруч, і перевірка, що ключі взагалі є.
//
// Чому підпис переїхав: 20.09.2026 `prices:push` із робочої машини поклав
// меню в живий бакет. Лікується це не уважністю, а тим, що ім'я бакета
// більше не береться з env: його дає bucketFor('pos'), і поза
// APP_ENV=production воно закінчується на `-dev` (backend/lib/src/r2.js).
import { appEnv, bucketFor, put as putObject } from "@extrovert/lib/r2.js";

// Своє читання .env звідси прибране (21.09.2026): раніше в pos/ лежав
// власний .env із тими самими ключами від R2, і два файли з однаковими
// секретами розходяться — застарілим завжди виявляється той, про який
// забули. Тепер файл один, у корені, і bun підхоплює його сам, коли скрипт
// запускають звідти (`make prices-push`).
export function loadEnv(env = process.env) {
  // Локально ключі беруться з MinIO (R2_DEV_*), у проді — з R2_*. Тому
  // обовʼязковим лишається лише те, що потрібне поточному оточенню.
  const need = appEnv(env) === "production"
    ? ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
    : ["R2_DEV_ENDPOINT", "R2_DEV_ACCESS_KEY_ID", "R2_DEV_SECRET_ACCESS_KEY"];
  for (const k of need) {
    if (!env[k]) { console.error(`✗ у .env немає ${k} (APP_ENV=${appEnv(env)})`); process.exit(1); }
  }
  return env;
}

export async function put(env, { key, body, contentType, cacheControl }) {
  const { bytes, bucket } = await putObject({
    purpose: "pos", key, body, contentType, cacheControl, env,
  });
  // Куди саме поїхало — видно одразу: різниця між `extrovert-pos` і
  // `extrovert-pos-dev` у виводі важливіша за будь-який коментар.
  console.log(`  → ${bucket}/${key}`);
  return bytes;
}

export const targetBucket = (env) => bucketFor("pos", env);
