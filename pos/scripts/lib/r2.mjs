// Підпис і заливка в R2 по S3-протоколу. Один модуль на всі скрипти: ціни
// й релізи їдуть в один бакет, і розʼїхатися в деталях підпису вони не мають.
//
// Бакет публічний на читання (pos.extrovert.cafe), тож ключі тут — це право
// ПИСАТИ. Вони живуть у pos/.env і на малині їх немає й бути не може.
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";

export function loadEnv(base = new URL("../../.env", import.meta.url)) {
  const env = Object.fromEntries(
    readFileSync(base, "utf8")
      .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!env[k]) { console.error(`✗ у pos/.env немає ${k}`); process.exit(1); }
  }
  return env;
}

// Заголовки кеша підписуються разом із запитом: бакет віддає Cloudflare
// напряму, нашого коду між ними немає, і поміняти їх потім можна лише
// перезаливкою обʼєкта.
export async function put(env, { key, body, contentType, cacheControl }) {
  const host = new URL(env.R2_ENDPOINT).host;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amz.slice(0, 8);
  const payload = createHash("sha256").update(body).digest("hex");
  const signed = "cache-control;content-type;host;x-amz-content-sha256;x-amz-date";

  const canonical = [
    "PUT", `/${env.R2_BUCKET}/${key}`, "",
    `cache-control:${cacheControl}`, `content-type:${contentType}`, `host:${host}`,
    `x-amz-content-sha256:${payload}`, `x-amz-date:${amz}`, "",
    signed, payload
  ].join("\n");

  const scope = `${date}/auto/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope,
    createHash("sha256").update(canonical).digest("hex")].join("\n");
  const hm = (k, d) => createHmac("sha256", k).update(d).digest();
  const sig = createHmac("sha256",
    hm(hm(hm(hm("AWS4" + env.R2_SECRET_ACCESS_KEY, date), "auto"), "s3"), "aws4_request"))
    .update(sts).digest("hex");

  const res = await fetch(`${env.R2_ENDPOINT}/${env.R2_BUCKET}/${key}`, {
    method: "PUT",
    headers: {
      host, "x-amz-date": amz, "x-amz-content-sha256": payload,
      "cache-control": cacheControl, "content-type": contentType,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope},` +
        `SignedHeaders=${signed},Signature=${sig}`
    },
    body
  });
  if (!res.ok) throw new Error(`${key}: ${res.status} ${await res.text()}`);
  return body.length;
}
