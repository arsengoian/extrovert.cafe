// Пароль адміна: scrypt у PHC-рядку (docs/services.md §3).
//
// Формат — `scrypt$N=65536,r=8,p=1$<сіль>$<хеш>`: параметри лежать поруч із
// хешем, тож їх можна підняти, не зламавши старі паролі. Звіряння —
// timingSafeEqual, щоб час відповіді не розповідав, наскільки пароль
// «майже правильний».
//
// Форми «зареєструватися» немає ніде: адміна заводить scripts/admin.mjs.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const PARAMS = { N: 65536, r: 8, p: 1 };
const KEY_LEN = 32;

export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, { ...params, maxmem: 256 * 1024 * 1024 });
  return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, phc) {
  if (!phc) return false;
  const [scheme, paramsRaw, saltRaw, hashRaw] = String(phc).split("$");
  if (scheme !== "scrypt" || !paramsRaw || !saltRaw || !hashRaw) return false;
  const params = Object.fromEntries(paramsRaw.split(",").map((kv) => {
    const [k, v] = kv.split("=");
    return [k, Number(v)];
  }));
  const expected = Buffer.from(hashRaw, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltRaw, "base64"), expected.length, {
    N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
