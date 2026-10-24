// Звідки людина прийшла за посиланням з UTM-мітками (власник, 24.10.2026):
// Instagram веде на extrovert.cafe/?utm_source=ig&utm_medium=social&
// utm_content=link_in_bio&fbclid=…
//
// Так само, як QR (qr.js): мітки забираємо з адреси, щойно застосунок
// відкрився, шлемо подію `utm` у власну аналітику (кожен такий захід), а
// першу пару міток кладемо в localStorage — і після входу api пише її в
// users.metadata.utm, лише якщо акаунт щойно створено (POST /me/utm). Тож
// в акаунті — звідки людина прийшла до реєстрації, а заходи вже наявних
// гравців лишаються подіями.
//
// fbclid / gclid — ідентифікатори кліку рекламних мереж: самі значення
// нікуди не пишемо, лише факт («click: fb»). Мітки з адреси прибираємо
// одразу: інакше вони розходились би з пересланим посиланням, і кожне
// пересилання рахувалось би заходом з Instagram.
import { api } from "./api.js";
import { trackUtm } from "./analytics.js";

const FIRST = "utm_first";
const SENT = "utm_sent";
const FIELDS = ["source", "medium", "campaign", "content", "term"];
const CLICKS = { fbclid: "fb", gclid: "google", ttclid: "tiktok" };
// Мітка — короткий текст без службових символів; довше 64 чи з дивним —
// краще без неї, ніж сміття в аналітиці.
const clean = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s && s.length <= 64 && /^[\p{L}\p{N} _.+-]+$/u.test(s) ? s : null;
};

/** Забрати мітки з адреси до будь-яких replaceState: подія й перша пара міток. */
export function takeUtm() {
  const url = new URL(window.location.href);
  const utm = {};
  for (const f of FIELDS) {
    const v = clean(url.searchParams.get(`utm_${f}`));
    if (v) utm[f] = v;
  }
  for (const [param, name] of Object.entries(CLICKS)) {
    if (url.searchParams.has(param)) { utm.click = name; break; }
  }
  const found = Object.keys(utm).length > 0;
  if (found) {
    try {
      if (!localStorage.getItem(FIRST)) localStorage.setItem(FIRST, JSON.stringify({ ...utm, landed_at: new Date().toISOString() }));
    } catch { /* приватний режим — захід однаково рахуємо */ }
    trackUtm(utm);
  }
  let changed = false;
  for (const p of [...url.searchParams.keys()]) {
    if (p.startsWith("utm_") || p in CLICKS) { url.searchParams.delete(p); changed = true; }
  }
  if (changed) window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  return found ? utm : null;
}

/** Після входу — віддати першу пару міток в акаунт, один раз на браузер. */
export async function reportUtm() {
  let first;
  try {
    const raw = localStorage.getItem(FIRST);
    if (!raw || localStorage.getItem(SENT) === raw) return;
    first = JSON.parse(raw);
    await api.post("/me/utm", first);
    localStorage.setItem(SENT, raw);
  } catch { /* наступний вхід спробує ще раз */ }
}
