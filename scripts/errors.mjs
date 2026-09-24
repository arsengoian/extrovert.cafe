// Помилки сервісів — у консоль, без веб-інтерфейсу.
//
//   bun scripts/errors.mjs                 # останні проблеми всіх проєктів
//   bun scripts/errors.mjs --project api   # лише один сервіс
//   bun scripts/errors.mjs --open 42       # остання подія проблеми: стек і теги
//   bun scripts/errors.mjs --resolve 42    # позначити полагодженою
//
// Навіщо: власник у GlitchTip не заглядає («я туди не буду заглядати»,
// 24.09.2026), а дивитись у нього треба щодня. CLI дешевший за звичку.
//
// Токен читання — GLITCHTIP_TOKEN у .env.prod (scopes: project/event/org
// read). DSN, якими сервіси ПИШУТЬ, тут не потрібні: вони не дають читати.
import { readFileSync } from "node:fs";

const env = (() => {
  const out = { ...process.env };
  for (const file of [".env.prod", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^"|"$/g, "");
      }
    } catch { /* немає файла — не біда */ }
  }
  return out;
})();

const HOST = env.GLITCHTIP_URL || "https://errors.extrovert.cafe";
const ORG = env.GLITCHTIP_ORG || "extrovert";
const TOKEN = env.GLITCHTIP_TOKEN;
if (!TOKEN) {
  console.error("немає GLITCHTIP_TOKEN (.env.prod). Створюється в GlitchTip → Profile → Auth Tokens");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1] ?? true;
};

const api = async (path) => {
  const res = await fetch(`${HOST}/api/0${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
};

const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)} с тому`;
  if (s < 3600) return `${Math.round(s / 60)} хв тому`;
  if (s < 86400) return `${Math.round(s / 3600)} год тому`;
  return `${Math.round(s / 86400)} дн тому`;
};

// ── одна проблема: останній випадок із стеком ───────────────────────────
if (flag("open")) {
  const id = String(flag("open"));
  const issue = await api(`/issues/${id}/`);
  const event = await api(`/issues/${id}/events/latest/`);
  console.log(`#${issue.id} ${issue.title}`);
  console.log(`   ${issue.culprit ?? ""}`);
  console.log(`   ${issue.count} разів · уперше ${ago(issue.firstSeen)} · востаннє ${ago(issue.lastSeen)}`);
  const entries = event.entries ?? [];
  const tags = Object.fromEntries((event.tags ?? []).map((t) => [t.key, t.value]));
  if (Object.keys(tags).length) console.log("   теги:", Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(" · "));
  for (const entry of entries) {
    if (entry.type !== "exception") continue;
    for (const value of entry.data?.values ?? []) {
      console.log(`\n   ${value.type}: ${value.value}`);
      const frames = value.stacktrace?.frames ?? [];
      // Найсвіжіший кадр — останній: перевертаємо, щоб місце падіння було
      // першим рядком, а не після двадцяти кадрів рантайму.
      for (const f of frames.slice().reverse().slice(0, 12)) {
        // API Sentry віддає кадри в camelCase (lineNo), а надсилаємо ми snake_case
        // (lineno) — приймаємо обидва, щоб рядок не був «undefined».
        console.log(`     ${f.filename}:${f.lineNo ?? f.lineno ?? "?"} ${f.function ?? ""}`);
      }
    }
  }
  process.exit(0);
}

// ── позначити полагодженою ──────────────────────────────────────────────
if (flag("resolve")) {
  const id = String(flag("resolve"));
  const res = await fetch(`${HOST}/api/0/issues/${id}/`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  });
  console.log(res.ok ? `#${id} позначено полагодженою` : `не вийшло: HTTP ${res.status} (токену треба event:write)`);
  process.exit(res.ok ? 0 : 1);
}

// ── список ──────────────────────────────────────────────────────────────
const only = flag("project");
const projects = (await api(`/organizations/${ORG}/projects/`))
  .filter((p) => !only || p.slug === only)
  .map((p) => p.slug);

let total = 0;
for (const slug of projects) {
  const issues = await api(`/projects/${ORG}/${slug}/issues/?query=is:unresolved&limit=10`);
  if (!issues.length) continue;
  total += issues.length;
  console.log(`\n══ ${slug}`);
  for (const i of issues) {
    console.log(`#${String(i.id).padEnd(5)} ${String(i.count).padStart(4)}× ${ago(i.lastSeen).padEnd(12)} ${i.title}`);
    if (i.culprit) console.log(`      ${i.culprit}`);
  }
}
console.log(total ? `\nвсього невирішених: ${total} · деталі: bun scripts/errors.mjs --open <id>` : "невирішених помилок немає");
