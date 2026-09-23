// Робота з R2 (S3-сумісний протокол): імена бакетів, підпис, заливка й
// підписані посилання.
//
// ── Чому цей файл узагалі існує ──────────────────────────────────────────
// 20.09.2026 команда `prices:push`, запущена з робочої машини «просто
// перевірити синтаксис», поклала меню в ЖИВИЙ бакет. Між наміром і продом
// не стояло нічого: один R2_BUCKET у .env і прод-ключі поруч. Тут це
// виправлено на рівні коду, а не домовленості:
//
//   1. бакет не пишеться руками — його дає bucketFor(purpose);
//   2. до імені додається суфікс оточення (`-dev`), і лише APP_ENV=production
//      дає прод-ім'я;
//   3. запис у прод-бакет із не-прод оточення кидає помилку. Обійти можна
//      одним явним R2_ALLOW_PROD=1 — тобто свідомо, а не випадково.
import { createHash, createHmac } from "node:crypto";

// Бакети за призначенням, а не за сервісом: у них різні строки зберігання,
// різні права й різні власники даних.
export const BUCKETS = {
  // Публічний на читання: меню точок і релізи кіоска (pos.extrovert.cafe).
  pos: "extrovert-pos",
  // Сирі сегменти з камер, lifecycle 7 днів + bucket lock (video.md).
  video: "extrovert-video",
  // Кадри й кліпи підтверджених подій — наші дані, живуть довго.
  evidence: "extrovert-evidence",
  // Фото, які надсилає гравець у скарзі. Окремо від evidence навмисно:
  // це чужі персональні дані, з іншим строком зберігання й іншим правом
  // доступу — гравець пише, адмінка читає, камери тут ні до чого.
  uploads: "extrovert-uploads",
  // Щоденні дампи Postgres від scheduler, lifecycle 30 днів.
  backups: "extrovert-backups",
};

// Оточення приходить із env-обʼєкта, а не лише з process.env: pos-скрипти
// читають власний pos/.env у памʼять і передають його сюди.
export const appEnv = (env = process.env) => env.APP_ENV || "local";
export const isProd = (env = process.env) => appEnv(env) === "production";

// Локально й на стейджі — свої бакети з суфіксом. Один рядок різниці в
// імені дешевший за будь-яку кількість обережності.
export function bucketFor(purpose, env = process.env) {
  const base = BUCKETS[purpose];
  if (!base) throw new Error(`невідоме призначення бакета: ${purpose}`);
  if (isProd(env)) return base;
  return `${base}-${appEnv(env) === "staging" ? "staging" : "dev"}`;
}

function guard(bucket, env) {
  const prod = Object.values(BUCKETS);
  if (prod.includes(bucket) && !isProd(env) && env.R2_ALLOW_PROD !== "1") {
    throw new Error(
      `відмова писати в прод-бакет «${bucket}» з оточення «${appEnv(env)}». ` +
      `Це навмисно: постав APP_ENV=production або R2_ALLOW_PROD=1, якщо справді цього хочеш`
    );
  }
}

// Поза продом спершу беремо дев-ключі (локально це MinIO з compose) — той
// самий прийом, що й DATABASE_URL_LOCAL у db.js. Прод-ключі в .env можуть
// лежати поруч, але самі по собі вони вже нічого не відкривають: бакети
// різні, а guard() нижче стереже прод-імена.
export function r2Config(env = process.env) {
  const dev = !isProd(env);
  const endpoint = (dev && env.R2_DEV_ENDPOINT) || env.R2_ENDPOINT;
  const key = (dev && env.R2_DEV_ACCESS_KEY_ID) || env.R2_ACCESS_KEY_ID;
  const secret = (dev && env.R2_DEV_SECRET_ACCESS_KEY) || env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !key || !secret) {
    throw new Error(dev
      ? "немає R2_DEV_ENDPOINT / R2_DEV_ACCESS_KEY_ID / R2_DEV_SECRET_ACCESS_KEY (підніми MinIO: bun run up)"
      : "немає R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
  }
  return { endpoint, key, secret, region: env.R2_REGION || "auto" };
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const stamps = () => {
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz, date: amz.slice(0, 8) };
};

const signingKey = (secret, date, region) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");

// ── заливка ─────────────────────────────────────────────────────────────
// Заголовки кеша підписуються разом із запитом: бакет віддає Cloudflare
// напряму, і поміняти їх потім можна лише перезаливкою обʼєкта.
export async function put({ purpose, bucket = null, key, body, contentType, cacheControl = "no-cache", env = process.env }) {
  const target = bucket ?? bucketFor(purpose, env);
  guard(target, env);
  const { endpoint, key: access, secret, region } = r2Config(env);
  const host = new URL(endpoint).host;
  const { amz, date } = stamps();
  const payload = sha256(body);
  const signed = "cache-control;content-type;host;x-amz-content-sha256;x-amz-date";

  const canonical = [
    "PUT", `/${target}/${key}`, "",
    `cache-control:${cacheControl}`, `content-type:${contentType}`, `host:${host}`,
    `x-amz-content-sha256:${payload}`, `x-amz-date:${amz}`, "",
    signed, payload,
  ].join("\n");

  const scope = `${date}/${region}/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(secret, date, region)).update(sts).digest("hex");

  const res = await fetch(`${endpoint}/${target}/${key}`, {
    method: "PUT",
    headers: {
      host,
      "x-amz-date": amz,
      "x-amz-content-sha256": payload,
      "cache-control": cacheControl,
      "content-type": contentType,
      authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope},SignedHeaders=${signed},Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`${target}/${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { bucket: target, key, bytes: body.length ?? body.byteLength ?? 0 };
}

// ── підписане посилання ─────────────────────────────────────────────────
// Фото зі скарги телефон заливає САМ, за підписаним URL: інакше кілька
// мегабайтів ішли б через api, який для цього не потрібен. Підпис живе
// хвилини, тому посилання не можна переслати «на потім».
// filename — коли посилання відкривають, щоб зберегти файл, а не подивитись:
// R2 віддасть його з Content-Disposition: attachment. Робимо це підписом, а
// не заголовком у застосунку: браузер іде в R2 навпростець, і жодного
// заголовка від нас там уже немає.
export function presign({ method = "PUT", purpose, bucket = null, key, expiresIn = 600, contentType = null, filename = null, env = process.env }) {
  const target = bucket ?? bucketFor(purpose, env);
  if (method !== "GET" && method !== "HEAD") guard(target, env);
  const { endpoint, key: access, secret, region } = r2Config(env);
  const host = new URL(endpoint).host;
  const { amz, date } = stamps();
  const scope = `${date}/${region}/s3/aws4_request`;

  // content-type підписуємо разом із запитом, коли він відомий: інакше
  // клієнт міг би залити під виглядом картинки будь-що.
  const signedHeaders = contentType ? "content-type;host" : "host";
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${access}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  // Порядок важливий: у канонічному запиті параметри мають іти відсортовані,
  // а "response-…" стоїть після всіх "X-Amz-…" (велика X — раніше за малу r).
  if (filename) {
    params.set("response-content-disposition", `attachment; filename="${filename.replaceAll('"', "")}"`);
  }

  const canonicalHeaders = contentType
    ? `content-type:${contentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const canonical = [
    method, `/${target}/${key}`, params.toString(),
    canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD",
  ].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(secret, date, region)).update(sts).digest("hex");
  params.set("X-Amz-Signature", signature);

  return {
    url: `${endpoint}/${target}/${key}?${params.toString()}`,
    bucket: target,
    key,
    expires_in: expiresIn,
  };
}
