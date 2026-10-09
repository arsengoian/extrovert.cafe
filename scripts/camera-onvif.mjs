// ONVIF для Tapo C100: показати профілі й дозволені роздільності, за
// потреби — виставити роздільність енкодера першого профілю (stream1).
//   bun scripts/camera-onvif.mjs <host:port>               # лише читання
//   bun scripts/camera-onvif.mjs <host:port> 1280x720      # виставити роздільність
//   bun scripts/camera-onvif.mjs <host:port> 1280x720 512  # + стеля бітрейту, кбіт/с
//
// Обсяг заливки задає БІТРЕЙТ, не роздільність: 1080p@1280 кбіт/с душить 4G
// аплінк точки незалежно від пікселів. Тому для 720p варто одразу опускати й
// бітрейт (камера для 720p сама тримає ~512 кбіт/с).
//
// Запускається на хості (не на малині — там немає bun). До камери на точці
// ходимо або з мережі кав'ярні напряму, або через тунель малини:
//   bash scripts/pi-forward.sh kyiv-01 47620 192.168.199.243:2020
//   bun scripts/camera-onvif.mjs localhost:47620 [WxH]
// SOAP-запити дрібні (кілька КБ), тож через тунель аплінк не вантажать —
// на відміну від відео.
//
// Логін і пароль — з raspberry/pi/camera.env (буквально, в лог не йдуть).
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const [hostPort, want, bitrate] = process.argv.slice(2);
if (!hostPort) throw new Error("usage: camera-onvif.mjs <host:port> [WxH]");
const envPath = process.env.CAM_ENV || new URL("../raspberry/pi/camera.env", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); let v = l.slice(i + 1); if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); return [l.slice(0, i), v]; })
);
const URL_ = `http://${hostPort}/onvif/service`;

function security() {
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(env.CAM_PASS)])).digest("base64");
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
<wsse:UsernameToken><wsse:Username>${esc(env.CAM_USER)}</wsse:Username>
<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</wsse:Nonce>
<wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function call(body, extraNs = "") {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" ${extraNs}>
<s:Header>${security()}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/soap+xml; charset=utf-8" }, body: xml });
  const t = await r.text();
  if (!r.ok || /Fault>/.test(t)) throw new Error(`HTTP ${r.status}: ${(t.match(/<[^>]*Text[^>]*>([^<]*)</) || [])[1] || t.slice(0, 400)}`);
  return t;
}
const all = (t, tag) => [...t.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g"))].map((m) => m[1]);
const first = (t, tag) => all(t, tag)[0];
const attr = (t, tag, a) => (t.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${a}="([^"]*)"`)) || [])[1];

const profiles = await call("<trt:GetProfiles/>");
const blocks = [...profiles.matchAll(/<(?:\w+:)?Profiles\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Profiles>/g)];
for (const [, a, b] of blocks) {
  const enc = b.match(/<(?:\w+:)?VideoEncoderConfiguration\b[^>]*token="([^"]*)"[\s\S]*?<\/(?:\w+:)?VideoEncoderConfiguration>/);
  console.log(`профіль ${(a.match(/token="([^"]*)"/) || [])[1]}: енкодер ${enc?.[1]}, ${first(b, "Width")}×${first(b, "Height")}, ` +
    `${first(b, "FrameRateLimit")} fps, ${first(b, "BitrateLimit")} кбіт/с, GOP ${first(b, "GovLength")}`);
}
const encToken = attr(profiles, "VideoEncoderConfiguration", "token");
const opts = await call(`<trt:GetVideoEncoderConfigurationOptions><trt:ConfigurationToken>${encToken}</trt:ConfigurationToken></trt:GetVideoEncoderConfigurationOptions>`);
const h264 = first(opts, "H264") || opts;
const res = all(h264, "ResolutionsAvailable").map((r) => `${first(r, "Width")}x${first(r, "Height")}`);
console.log(`дозволено для ${encToken}: ${res.join(", ")}`);
if (!want) process.exit(0);

if (!res.includes(want)) throw new Error(`${want} немає серед дозволених`);
const [w, h] = want.split("x");
const cur = await call(`<trt:GetVideoEncoderConfiguration><trt:ConfigurationToken>${encToken}</trt:ConfigurationToken></trt:GetVideoEncoderConfiguration>`);
// Конфігурацію беремо як є й міняємо лише Width/Height: решту полів
// (якість, бітрейт, GOP) камера має отримати назад без змін.
const m = cur.match(/<(\w+:)?Configuration\b([^>]*)>([\s\S]*?)<\/\1?Configuration>/);
const ns = [...cur.matchAll(/xmlns:(\w+)="([^"]*)"/g)].filter(([, p]) => !["s", "trt", "tt"].includes(p)).map(([x]) => x).join(" ");
let inner = m[3]
  .replace(/(<(?:\w+:)?Resolution>[\s\S]*?<(?:\w+:)?Width>)\d+/, `$1${w}`)
  .replace(/(<(?:\w+:)?Resolution>[\s\S]*?<(?:\w+:)?Height>)\d+/, `$1${h}`);
// Бітрейт — лише якщо задано: решту полів RateControl лишаємо як є.
if (bitrate) inner = inner.replace(/(<(?:\w+:)?BitrateLimit>)\d+/, `$1${Number(bitrate)}`);
await call(`<trt:SetVideoEncoderConfiguration><trt:Configuration${m[2]}>${inner}</trt:Configuration><trt:ForcePersistence>true</trt:ForcePersistence></trt:SetVideoEncoderConfiguration>`, ns);
const after = await call(`<trt:GetVideoEncoderConfiguration><trt:ConfigurationToken>${encToken}</trt:ConfigurationToken></trt:GetVideoEncoderConfiguration>`);
console.log(`після: ${first(after, "Width")}×${first(after, "Height")}, ${first(after, "BitrateLimit")} кбіт/с`);
