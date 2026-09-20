// Один JWT на api і ws, підписує лише api (docs/services.md §3).
// Ed25519: підпис 64 байти, перевірка публічним ключем, жодних залежностей.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const unb64url = (s) => Buffer.from(s, "base64url");

// Локально ключа може не бути — генеруємо на старті й друкуємо підказку.
// На стейджі й проді він приходить змінною оточення, інакше рестарт api
// розлогінив би всіх.
function loadKeys() {
  const pem = process.env.JWT_PRIVATE_KEY;
  if (pem) {
    // У .env ключ лежить одним рядком із \n; PEM без фінального переносу
    // OpenSSL не читає взагалі — звідси і кінцевий перенос.
    // У .env ключ лежить одним рядком із \n. Два місця, де це ламається:
    // екрановані переноси треба розгорнути, а \r від CRLF-файла прибрати —
    // інакше PEM закінчується не тим символом і OpenSSL його не читає.
    const text = pem.replace(/\\n/g, "\n").replace(/\r/g, "").trim() + "\n";
    const privateKey = createPrivateKey(text);
    return { privateKey, publicKey: createPublicKey(privateKey) };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey, ephemeral: true };
}

const keys = loadKeys();
export const ephemeralKey = Boolean(keys.ephemeral);

const ACCESS_TTL_S = 15 * 60; // 15 хвилин, як у доках

export function signToken(sub, role, extra = {}) {
  const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, role, iat: now, exp: now + ACCESS_TTL_S, ...extra }));
  const data = `${header}.${payload}`;
  return `${data}.${b64url(sign(null, Buffer.from(data), keys.privateKey))}`;
}

export function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!verify(null, Buffer.from(`${header}.${payload}`), keys.publicKey, unb64url(signature))) return null;
  const claims = JSON.parse(unb64url(payload).toString());
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// Витягує гравця із заголовка. Повертає null, а не кидає: частина роутів
// працює і без входу (стартовий екран, довідники).
export function userFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const claims = token ? verifyToken(token) : null;
  if (!claims || !String(claims.sub).startsWith("user:")) return null;
  return { id: String(claims.sub).slice(5), role: claims.role };
}

export function requireUser(req, reply) {
  const user = userFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return user;
}
