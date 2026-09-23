// Токен для кіоска: ним кіоск підписується на канал своєї точки в ws.
//
//   bun scripts/point-token.mjs kyiv-01            # рік
//   bun scripts/point-token.mjs kyiv-01 --days 90
//
// Чому довгий і чому видається руками, а не роутом: кіоск — не людина з
// логіном, а залізяка в кутку кав'ярні, яка має самостійно підніматись
// після будь-якого перезавантаження. Короткий токен вимагав би від неї
// вміти оновлюватись, тобто ще одного секрета на пристрої й ще одного
// роута на сервері — за нульової різниці в захищеності: обидва однаково
// лежать на тій самій флешці.
//
// Токен дає рівно одне право: слухати `point:<id>`. Ні читати, ні міняти
// нічого ним не можна (ws.js перевіряє лише канал), тож витік із пристрою
// означає, що хтось бачить QR-и тієї ж точки — ті самі, що світяться на
// екрані в залі.
import { createHash, createPrivateKey, sign } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

const args = process.argv.slice(2);
const point = args.find((a) => !a.startsWith("--"));
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 365;

if (!point) {
  console.error("вкажи точку: bun scripts/point-token.mjs <point-id> [--days N]");
  process.exit(1);
}
if (!Number.isFinite(days) || days <= 0) {
  console.error("--days має бути додатним числом");
  process.exit(1);
}

const pem = process.env.JWT_PRIVATE_KEY;
if (!pem) {
  console.error("✗ немає JWT_PRIVATE_KEY у .env — новий ключ робить `make keys-jwt`");
  console.error("  (і це має бути той самий ключ, що в api на сервері, інакше ws токен не прийме)");
  process.exit(1);
}

// Той самий розбір, що в backend/api/src/auth.js: у .env ключ лежить одним рядком.
const privateKey = createPrivateKey(pem.replace(/\\n/g, "\n").replace(/\r/g, "").trim() + "\n");

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
const payload = b64url(JSON.stringify({
  sub: `point:${point}`,
  role: "point",
  iat: now,
  exp: now + days * 24 * 60 * 60,
}));
const data = `${header}.${payload}`;
const token = `${data}.${b64url(sign(null, Buffer.from(data), privateKey))}`;

const until = new Date((now + days * 24 * 60 * 60) * 1000).toISOString().slice(0, 10);
console.log(`точка: point:${point}`);
console.log(`дійсний до: ${until}`);
console.log(`\n${token}\n`);
console.log("На кіоску це змінна WS_TOKEN (raspberry/kiosk/docs — «Що задається оточенням»).");

// Хеш виданого токена — у points.key_hash. Перевіряє токен усе одно підпис,
// але адмінка показує саме цю колонку: без запису вона казала «кіоск працює
// без токена» про точку, яка щохвилини шле телеметрію.
const keyHash = createHash("sha256").update(token).digest("hex");
try {
  const { pool } = await import("@extrovert/lib/db.js");
  const { rowCount } = await pool.query(
    "update points set key_hash = $2, key_revoked_at = null where id = $1",
    [point, keyHash]
  );
  await pool.end();
  console.log("");
  console.log(rowCount
    ? "✓ хеш токена записаний у points.key_hash"
    : `! точки ${point} у базі немає — хеш нікуди записати`);
} catch (e) {
  console.log("");
  console.log(`! база недоступна (${e.message}) — токен робочий, але points.key_hash лишився старим`);
}
