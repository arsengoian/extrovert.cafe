// Заливає меню точки в R2 під ключем points/<point>/menu.json.
//   node scripts/push-prices.mjs                  → точка kyiv-01, файл data/prices.json
//   node scripts/push-prices.mjs kyiv-02          → інша точка, той самий файл
//   node scripts/push-prices.mjs kyiv-02 ./m.json → інша точка, інший файл
// Використання: node scripts/push-prices.mjs [шлях]
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const POINT = (process.argv[2] && !process.argv[2].includes(".")) ? process.argv[2] : "kyiv-01";
const fileArg = process.argv.find((a, i) => i >= 2 && a.includes("."));
const file = fileArg || new URL("../data/prices.json", import.meta.url);
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(POINT)) {
  console.error("✗ некоректний id точки:", POINT); process.exit(1);
}
const body = readFileSync(file);
JSON.parse(body.toString());                       // впаде, якщо JSON битий

const KEY = `points/${POINT}/menu.json`, BUCKET = env.R2_BUCKET;
const host = new URL(env.R2_ENDPOINT).host;
const now = new Date();
const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
const date = amz.slice(0, 8);
const payload = createHash("sha256").update(body).digest("hex");

const canonical = [
  "PUT", `/${BUCKET}/${KEY}`, "",
  `host:${host}`, `x-amz-content-sha256:${payload}`, `x-amz-date:${amz}`, "",
  "host;x-amz-content-sha256;x-amz-date", payload
].join("\n");

const scope = `${date}/auto/s3/aws4_request`;
const sts = ["AWS4-HMAC-SHA256", amz, scope,
  createHash("sha256").update(canonical).digest("hex")].join("\n");
const hm = (k, d) => createHmac("sha256", k).update(d).digest();
const sig = createHmac("sha256",
  hm(hm(hm(hm("AWS4" + env.R2_SECRET_ACCESS_KEY, date), "auto"), "s3"), "aws4_request"))
  .update(sts).digest("hex");

const res = await fetch(`${env.R2_ENDPOINT}/${BUCKET}/${KEY}`, {
  method: "PUT",
  headers: {
    host, "x-amz-date": amz, "x-amz-content-sha256": payload,
    "content-type": "application/json",
    Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope},` +
      `SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=${sig}`
  },
  body
});
console.log(res.ok ? `✓ ${KEY} залито (${body.length} B)` : `✗ ${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
