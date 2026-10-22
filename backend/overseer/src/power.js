// Перезавантаження малини живленням через розумну розетку Tuya (власник,
// 22.10.2026; docs/raspberry-pi.md, «Перезавантаження живленням»).
//
// Навіщо. Сторож картки на малині (bin/telemetry --sdwatch) уміє лише
// м'який ребут, а 21.10.2026 картка відпала з шини зовсім («card removed»):
// на Pi 1 живлення картки програмно не вимкнути, і після ребуту
// завантажувач її не побачив. Таку картку оживляє лише знеструмлення.
//
// Коли. Малина мовчить ≥ POWER_CYCLE_AFTER_MIN хвилин (сторожу треба дати
// спробувати самому: його ребут — хвилина-дві) і розетка онлайн у хмарі
// Tuya. Розетка онлайн = на точці є світло й інтернет: у блекаут вона
// офлайн, і вимикати нема чого — тоді ми нічого не робимо й ліміт не
// чіпаємо. Ліміт — POINT_POWER_CYCLES_PER_DAY на добу (3) і не частіше
// ніж раз на POWER_CYCLE_COOLDOWN_MIN (20 хв), журнал — point_reboots з
// kind = 'power', у базі сервера, як і в сторожа.
//
// Без TUYA_ACCESS_ID / TUYA_ACCESS_SECRET і без points.power_plug_id —
// нічого не робить.
import { createHash, createHmac, randomUUID } from "node:crypto";

const TUYA = {
  id: process.env.TUYA_ACCESS_ID,
  secret: process.env.TUYA_ACCESS_SECRET,
  // Дата-центр проєкту на iot.tuya.com: Central Europe — tuyaeu.
  base: process.env.TUYA_API_URL || "https://openapi.tuyaeu.com",
  // Код реле в моделі пристрою; у одноканальних розеток — switch_1.
  switchCode: process.env.TUYA_SWITCH_CODE || "switch_1",
};
export const tuyaConfigured = () => Boolean(TUYA.id && TUYA.secret);

export const POWER = {
  afterMin: Number(process.env.POWER_CYCLE_AFTER_MIN ?? 6),
  offSeconds: Number(process.env.POWER_CYCLE_OFF_S ?? 10),
  perDay: Number(process.env.POINT_POWER_CYCLES_PER_DAY ?? 3),
  cooldownMin: Number(process.env.POWER_CYCLE_COOLDOWN_MIN ?? 20),
};

// ── Tuya Cloud: підпис і виклики ─────────────────────────────────────────
// Підпис — HMAC-SHA256 від client_id + access_token + t + nonce +
// stringToSign, де stringToSign = метод \n sha256(тіла) \n (підписаних
// заголовків немає) \n шлях із запитом; для самого токена access_token
// порожній. Великими літерами.
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function tuyaSign({ method, path, body = "", token = "", t, nonce }, secret = TUYA.secret, id = TUYA.id) {
  const stringToSign = [method, sha256(body), "", path].join("\n");
  return createHmac("sha256", secret).update(id + token + t + nonce + stringToSign).digest("hex").toUpperCase();
}

let cached = null;   // { token, expires }

async function call(method, path, payload, { auth = true } = {}) {
  const body = payload ? JSON.stringify(payload) : "";
  const token = auth ? await accessToken() : "";
  const t = String(Date.now());
  const nonce = randomUUID();
  const headers = {
    client_id: TUYA.id,
    sign: tuyaSign({ method, path, body, token, t, nonce }),
    sign_method: "HMAC-SHA256",
    t,
    nonce,
    ...(auth ? { access_token: token } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(TUYA.base + path, { method, headers, body: body || undefined, signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    if (auth) cached = null;   // протухлий токен — наступний виклик візьме новий
    throw new Error(`tuya ${method} ${path.split("?")[0]}: ${json.code ?? res.status} ${json.msg ?? ""}`.trim());
  }
  return json.result;
}

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const r = await call("GET", "/v1.0/token?grant_type=1", null, { auth: false });
  cached = { token: r.access_token, expires: Date.now() + Number(r.expire_time ?? 3600) * 1000 };
  return cached.token;
}

export const plugOnline = async (id) => Boolean((await call("GET", `/v1.0/devices/${id}`))?.online);
export const plugSwitch = (id, on) =>
  call("POST", `/v1.0/devices/${id}/commands`, { commands: [{ code: TUYA.switchCode, value: on }] });

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Увімкнути назад — кілька спроб: вимкнена й не ввімкнена розетка гірша за
// «зомбі», бо тоді малина не підніметься й після блекауту.
async function powerBackOn(id) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { await plugSwitch(id, true); return null; } catch (e) { last = e; await sleep(5_000 * (i + 1)); }
  }
  return last;
}

// ── рішення ──────────────────────────────────────────────────────────────
// → рядки для Telegram (обхід overseer шле їх разом з іншими).
export async function checkPower(pool, { log } = {}) {
  if (!tuyaConfigured()) return [];
  const { rows } = await pool.query(
    `select p.id, p.name, p.power_plug_id,
            extract(epoch from (now() - p.last_seen_at)) / 60 as silent,
            (select count(*)::int from point_reboots r
              where r.point_id = p.id and r.kind = 'power' and r.granted and not r.test
                and r.requested_at > now() - interval '24 hours') as used,
            (select extract(epoch from (now() - max(r.requested_at))) / 60 from point_reboots r
              where r.point_id = p.id and r.kind = 'power' and r.granted and not r.test) as since_last
       from points p
      where p.status = 'live' and p.power_plug_id is not null and p.last_seen_at is not null`
  );
  const lines = [];
  for (const p of rows) {
    const silent = Number(p.silent);
    if (silent < POWER.afterMin) continue;
    if (p.since_last !== null && Number(p.since_last) < POWER.cooldownMin) continue;
    if (p.used >= POWER.perDay) continue;   // про вичерпаний ліміт каже «мовчить» самої точки
    let online;
    try { online = await plugOnline(p.power_plug_id); } catch (e) {
      log?.warn({ err: e.message, point: p.id }, "розетку Tuya не спитати");
      continue;
    }
    if (!online) continue;   // світла чи інтернету на точці немає — вимикати нічого

    const minutes = Math.round(silent);
    await pool.query(
      "insert into point_reboots (point_id, kind, reason, granted) values ($1, 'power', $2, true)",
      [p.id, `мовчить ${minutes} хв, розетка онлайн`]);
    try {
      await plugSwitch(p.power_plug_id, false);
    } catch (e) {
      lines.push(`⚠️ ${p.name}: мовчить ${minutes} хв, а вимкнути розетку не вдалось — ${e.message}`);
      continue;
    }
    await sleep(POWER.offSeconds * 1000);
    const failed = await powerBackOn(p.power_plug_id);
    lines.push(failed
      ? `🚨 ${p.name}: розетку вимкнули, а ввімкнути назад не вдалось — ${failed.message}. Малина без живлення, увімкніть розетку в застосунку`
      : `🔁 ${p.name}: мовчить ${minutes} хв, а світло є — перезавантажив живленням (${p.used + 1}/${POWER.perDay} за добу)`);
    log?.info({ point: p.id, minutes, failed: failed?.message }, "перезавантаження живленням");
  }
  return lines;
}
