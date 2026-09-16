#!/usr/bin/env node
// build-data-map.mjs — збирає docs/data-map.html з усіх чинних доків.
//
// Джерело істини — markdown. HTML похідний і руками не редагується: перша
// версія сторінки жила окремою копією діаграм, і той самий баг у mermaid
// довелось виправляти у двох місцях (15.09.2026). Тепер копії немає.
//
//   node scripts/build-data-map.mjs                  # перегенерувати docs/data-map.html
//   node scripts/build-data-map.mjs --check          # код 1: html застарів, реєстр дірявий або ER битий
//   node scripts/build-data-map.mjs --artifact <out> # варіант для claude.ai, без mermaid-скрипта
//   node scripts/build-data-map.mjs --hook           # PostToolUse-хук Claude Code (stdin JSON)
//
// Які доки потрапляють на сторінку, вирішує реєстр docs/README.md, а не цей
// скрипт: ## група → таблиця з файлами.
// Окремого списку тут свідомо немає — інакше реєстр і сторінка розходились
// би так само, як колись розійшлися копії діаграм. Док із docs/, якого нема
// в реєстрі, — попередження, і --check не проходить.
//
// Меню будується з самої структури доків: група → # документ → розділ →
// підрозділ → ще рівень → діаграма → окремі таблиці з ER. Рівні рахуються
// від найменшого заголовка в доці, тож док, що починається з «#», і док із
// «##» дають однакове меню.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "docs/data-map.html";
const REGISTRY = "docs/README.md";

// Якорі #db-… і #svc-… уже розіслані посиланнями з першої версії сторінки,
// тому ключі цих двох доків фіксовані. Решта — з імені файла.
const FIXED_KEYS = { "docs/db-schema.md": "db", "docs/services.md": "svc" };

const MERMAID_VERSION = "10.9.1";

// ── дрібні утиліти ──────────────────────────────────────────────────────
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Підпис для меню: без markdown-розмітки, але з кодом як текстом.
const plain = (s) => String(s).replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\*([^*]*)\*/g, "$1").trim();

function slugger() {
  const used = new Map();
  const slug = (prefix, text) => {
    const base =
      prefix +
      "-" +
      plain(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  // Ключі доків займаються наперед: розділ «stack» у pi/README.md інакше
  // отримав би id «pi-stack» — той самий, що й док pi/stack/README.md.
  slug.reserve = (id) => used.set(id, (used.get(id) || 0) + 1);
  return slug;
}

const plural = (n, [one, few, many]) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

const readText = (file) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const samePath = (a, b) => {
  const ra = path.resolve(a), rb = path.resolve(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
};

// ── розбір ER-діаграми ─────────────────────────────────────────────────────
// Розбираємо лише ту підмножину mermaid, якою пишуться наші доки. Усе, що не
// розпізнано, — попередження: саме так ловиться помилка на кшталт
// `uuid user_id FK UK` (ключі мають іти через кому), яку mermaid відмовляється
// малювати, а markdown-прев'ю мовчки показує як текст.
const LEFT = { "||": "1", "|o": "0..1", "}o": "0..N", "}|": "1..N" };
const RIGHT = { "||": "1", "o|": "0..1", "o{": "0..N", "|{": "1..N" };
const RE_REL = /^([A-Za-z_][\w-]*)\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+([A-Za-z_][\w-]*)\s*:\s*(?:"([^"]*)"|(.+))$/;
const RE_OPEN = /^([A-Za-z_][\w-]*)\s*\{$/;
const RE_ATTR = /^(\S+)\s+([A-Za-z_][\w-]*)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/;

function parseER(src, where) {
  const entities = new Map();
  const relations = [];
  const warnings = [];
  let cur = null;
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    const at = `${where}, рядок ${i + 1}`;
    if (!line || line === "erDiagram" || line.startsWith("%%")) return;
    if (cur) {
      if (line === "}") { cur = null; return; }
      const m = line.match(RE_ATTR);
      if (!m) { warnings.push(`${at}: атрибут не розпізнано — «${line}»`); return; }
      cur.attrs.push({
        type: m[1],
        name: m[2],
        keys: m[3] ? m[3].split(",").map((k) => k.trim()) : [],
        note: m[4] || "",
      });
      return;
    }
    let m = line.match(RE_OPEN);
    if (m) {
      if (entities.has(m[1])) warnings.push(`${at}: таблицю ${m[1]} описано двічі`);
      cur = { name: m[1], attrs: [] };
      entities.set(m[1], cur);
      return;
    }
    m = line.match(RE_REL);
    if (m) {
      relations.push({ a: m[1], b: m[5], aCard: LEFT[m[2]], bCard: RIGHT[m[4]], label: m[6] ?? m[7].trim() });
      return;
    }
    warnings.push(`${at}: рядок не розпізнано — «${line}»`);
  });
  if (cur) warnings.push(`${where}: таблиця ${cur.name} не закрита «}»`);
  return { entities, relations, warnings };
}

// ── реєстр доків ──────────────────────────────────────────────────────────
// docs/README.md: «## Група», під нею таблиця, у першій колонці — шлях у
// бектиках відносно docs/. Не-markdown рядки (data-map.html) пропускаються.
function readRegistry() {
  const md = readText(REGISTRY);
  const warnings = [];
  const groups = [];
  const archived = [];
  const listed = new Set();
  let group = null;
  for (const t of new Marked().lexer(md)) {
    if (t.type === "heading" && t.depth === 2) {
      group = { title: plain(t.text), archive: /архів/i.test(t.text), docs: [] };
      if (!group.archive) groups.push(group);
    } else if (t.type === "table" && group) {
      for (const row of t.rows) {
        const m = (row[0]?.text ?? "").trim().match(/^`([^`]+\.md)`$/i);
        if (!m) continue;
        const file = path.posix.normalize(path.posix.join(path.posix.dirname(REGISTRY), m[1]));
        if (listed.has(file)) { warnings.push(`реєстр: ${file} записано двічі`); continue; }
        listed.add(file);
        if (!existsSync(path.join(ROOT, file))) { warnings.push(`реєстр: ${file} не існує`); continue; }
        (group.archive ? archived : group.docs).push(file);
      }
    }
  }
  // Док, якого нема в реєстрі, мовчки випав би зі сторінки — саме так
  // сторінка колись показувала два доки з шістнадцяти.
  for (const name of readdirSync(path.join(ROOT, "docs")).sort()) {
    const file = `docs/${name}`;
    if (/\.md$/i.test(name) && file !== REGISTRY && !listed.has(file)) {
      warnings.push(`реєстр: ${file} не записаний у ${REGISTRY}`);
    }
  }
  return { md, groups: groups.filter((g) => g.docs.length), archived, listed, warnings };
}

const docKey = (file) =>
  FIXED_KEYS[file] ??
  file
    .replace(/^docs\//, "")
    .replace(/(^|\/)README\.md$/i, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// `raspberry-pi.md` у тексті — посилання на цей док на сторінці. Шлях
// пробуємо відносно самого дока, від кореня й від docs/: у pi/README.md
// пишуть `stack/README.md`, у доках — `pi/stack/README.md` або `services.md`.
function resolveDocRef(fromFile, ref, keys) {
  const clean = ref.trim().replace(/\\/g, "/");
  for (const cand of [path.posix.join(path.posix.dirname(fromFile), clean), clean, path.posix.join("docs", clean)]) {
    const key = keys.get(path.posix.normalize(cand));
    if (key) return key;
  }
  return null;
}

// ── модель: токени, меню, реєстр таблиць ────────────────────────────────────
const LEVEL_KINDS = ["section", "sub", "subsub"]; // глибші заголовки — лише якір, без пункту меню

function parseDoc(file, key, ctx) {
  const md = readText(file);
  const tokens = new Marked().lexer(md);
  const headings = tokens.filter((t) => t.type === "heading");
  const titleTok = headings[0]?.depth === 1 ? headings[0] : null;
  if (!titleTok) ctx.warnings.push(`${file}: немає заголовка «# …» на початку — у меню йде імʼя файла`);
  const title = titleTok ? plain(titleTok.text) : file;
  if (titleTok) titleTok._skip = true;
  const base = Math.min(6, ...headings.filter((h) => h !== titleTok).map((h) => h.depth));
  const doc = { file, key, md, tokens, title, nav: { id: key, label: title, kind: "doc", children: [] } };

  const trail = []; // trail[рівень] = пункт меню поточного заголовка
  const deepest = () => trail.filter(Boolean).at(-1) || doc.nav;
  let nDiagram = 0;
  for (const t of tokens) {
    if (t.type === "heading" && t !== titleTok) {
      const level = t.depth - base;
      t._id = ctx.slug(key, t.text);
      t._render = Math.min(6, level + 2); // документ — h1, його розділи — h2, як на всій сторінці
      if (level >= LEVEL_KINDS.length) continue;
      const node = { id: t._id, label: plain(t.text), kind: LEVEL_KINDS[level], children: [] };
      trail.length = level;
      deepest().children.push(node);
      trail[level] = node;
    } else if (t.type === "code" && t.lang === "mermaid") {
      nDiagram++;
      const kind = /^\s*erDiagram/.test(t.text) ? "er" : "graph";
      const node = { id: `${key}-diagram-${nDiagram}`, kind, children: [] };
      if (kind === "er") {
        const er = parseER(t.text, `${file}, діаграма ${nDiagram}`);
        ctx.warnings.push(...er.warnings);
        ctx.allRelations.push(...er.relations);
        for (const e of er.entities.values()) {
          const anchor = `t-${e.name.toLowerCase()}`;
          if (ctx.registry.has(e.name)) { ctx.warnings.push(`${file}: таблицю ${e.name} уже описано в іншій діаграмі`); continue; }
          ctx.registry.set(e.name, { anchor });
          node.children.push({ id: anchor, label: e.name.toLowerCase(), kind: "table", children: [] });
        }
        node.label = `${er.entities.size} ${plural(er.entities.size, ["таблиця", "таблиці", "таблиць"])}`;
        t._er = er;
      } else {
        node.label = "Схема";
      }
      t._diagram = node;
      deepest().children.push(node);
    } else if (t.type === "hr") {
      t._skip = true;
    }
  }
  return doc;
}

function buildModel() {
  const reg = readRegistry();
  const ctx = { slug: slugger(), registry: new Map(), allRelations: [], warnings: [...reg.warnings] };
  const keys = new Map(); // файл → ключ дока, для посилань між доками
  for (const g of reg.groups) for (const file of g.docs) keys.set(file, docKey(file));
  for (const key of keys.values()) ctx.slug.reserve(key);

  const docs = [];
  const groups = reg.groups.map((g) => {
    const id = ctx.slug("g", g.title);
    const groupDocs = g.docs.map((file) => parseDoc(file, keys.get(file), ctx));
    docs.push(...groupDocs);
    return { id, title: g.title, docs: groupDocs, nav: { id, label: g.title, kind: "group", children: groupDocs.map((d) => d.nav) } };
  });
  return { reg, groups, docs, keys, registry: ctx.registry, allRelations: ctx.allRelations, warnings: ctx.warnings };
}

// ── рендер ────────────────────────────────────────────────────────────────
function entityCards(er, model) {
  const cards = [...er.entities.values()].map((e) => {
    const anchor = `t-${e.name.toLowerCase()}`;
    const rows = e.attrs
      .map((a) => {
        const keys = a.keys.map((k) => `<span class="key key-${k.toLowerCase()}">${k}</span>`).join("");
        return `<tr><td class="c-name">${esc(a.name)}</td><td class="c-type">${esc(a.type)}</td><td class="c-keys">${keys}</td><td class="c-note">${esc(a.note)}</td></tr>`;
      })
      .join("");
    // Звʼязки збираються з УСІХ діаграм: receipts ↔ video_events оголошено в
    // розділі операційки, але шукати його будуть на картці receipts.
    const rels = model.allRelations
      .filter((r) => r.a === e.name || r.b === e.name)
      .map((r) => {
        const out = r.a === e.name;
        const other = out ? r.b : r.a;
        const card = out ? r.bCard : r.aCard;
        const target = model.registry.get(other);
        const name = esc(other.toLowerCase());
        const link = target ? `<a href="#${target.anchor}">${name}</a>` : `<span>${name}</span>`;
        return `<li><span class="rel-card">${out ? "→" : "←"} ${card}</span>${link}<span class="rel-label">${esc(r.label)}</span></li>`;
      })
      .join("");
    return `<article class="entity" id="${anchor}">
  <header><h4>${esc(e.name.toLowerCase())}</h4><span class="entity-count">${e.attrs.length} кол.</span></header>
  <div class="cols"><table>${rows}</table></div>
  ${rels ? `<ul class="rels">${rels}</ul>` : ""}
</article>`;
  });
  return `<div class="dict">${cards.join("\n")}</div>`;
}

// init-директива всередині діаграми, а не в mermaid.initialize: її чує і
// наша сторінка, і хост claude.ai, який малює mermaid сам. Широкі ER-схеми
// без useMaxWidth лишаються читабельними й скроляться, а не стискаються в
// дрібний шрифт на ширину колонки.
const MERMAID_INIT =
  '%%{init: {"theme": "default", "er": {"useMaxWidth": false}, "flowchart": {"useMaxWidth": false}}}%%\n';

function renderDoc(doc, model) {
  const marked = new Marked();
  marked.use({
    renderer: {
      heading(t) {
        if (t._skip) return "";
        const inner = this.parser.parseInline(t.tokens);
        const h = t._render;
        return `<h${h} id="${t._id}"><a class="anchor" href="#${t._id}" aria-hidden="true">#</a>${inner}</h${h}>\n`;
      },
      codespan(t) {
        const code = `<code>${esc(t.text)}</code>`;
        const target = /\.md$/i.test(t.text) ? resolveDocRef(doc.file, t.text, model.keys) : null;
        return target && target !== doc.key ? `<a class="doclink" href="#${target}">${code}</a>` : code;
      },
      hr(t) {
        return t._skip ? "" : "<hr>\n";
      },
      table(t) {
        return `<div class="tablewrap">${Renderer.prototype.table.call(this, t)}</div>\n`;
      },
      code(t) {
        if (t.lang !== "mermaid") return false;
        const d = t._diagram;
        const tag = d.kind === "er" ? "ER" : "Схема";
        const plate = `<figure class="plate" id="${d.id}">
  <figcaption class="plate-head"><span class="tag">${tag}</span>${d.kind === "er" ? `<span class="plate-meta">${d.children.length} ${plural(d.children.length, ["таблиця", "таблиці", "таблиць"])} нижче — з колонками й звʼязками</span>` : ""}</figcaption>
  <div class="plate-body"><pre class="mermaid">${esc(MERMAID_INIT + t.text)}</pre></div>
</figure>\n`;
        return d.kind === "er" ? plate + entityCards(t._er, model) + "\n" : plate;
      },
    },
  });
  return `<section class="doc" id="${doc.key}">
<header class="doc-head"><p class="doc-src">${esc(doc.file)}</p><h1>${esc(doc.title)}</h1></header>
${marked.parser(doc.tokens)}
</section>`;
}

function navHTML(node) {
  const kids = node.children.map(navHTML).join("");
  const badge =
    node.kind === "er" ? `<span class="nav-badge">ER</span>` : node.kind === "graph" ? `<span class="nav-badge">схема</span>` : "";
  const label = `<a href="#${node.id}">${badge}${esc(node.label)}</a>`;
  if (!kids) return `<li class="nav-${node.kind}">${label}</li>`;
  // Відкриті лише групи: з півтора десятка доків, розгорнутих до розділів,
  // меню довше за саму сторінку. Гілку того, що читаєш, розкриває підсвітка.
  const open = node.kind === "group";
  return `<li class="nav-${node.kind}"><details${open ? " open" : ""}><summary>${label}</summary><ul>${kids}</ul></details></li>`;
}

const STYLE = `
:root{--ground:#0C0E11;--surface:#14171C;--surface-2:#1B1F26;--line:#2A3039;--ink:#F2EFE6;--ink-dim:#9AA3B0;--ink-faint:#6B7480;--accent:#FE810B;--accent-2:#FF2D6F;--plate:#FBF9F6;--plate-line:#E4DED4;--plate-ink:#2A2620;--radius:12px}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--ground:#F7F5F1;--surface:#FFFFFF;--surface-2:#F1EDE6;--line:#E0D9CE;--ink:#1E1B17;--ink-dim:#5E5852;--ink-faint:#8B8478;--accent:#C2610A;--accent-2:#D41E57}}
:root[data-theme="light"]{--ground:#F7F5F1;--surface:#FFFFFF;--surface-2:#F1EDE6;--line:#E0D9CE;--ink:#1E1B17;--ink-dim:#5E5852;--ink-faint:#8B8478;--accent:#C2610A;--accent-2:#D41E57}
*{box-sizing:border-box}
html{scroll-padding-top:16px}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.86em;background:var(--surface-2);padding:1px 5px;border-radius:4px;color:var(--ink)}
.top{border-bottom:1px solid var(--line);padding:34px 20px 26px;background:radial-gradient(800px 300px at 10% -20%,color-mix(in srgb,var(--accent) 15%,transparent),transparent 70%),radial-gradient(640px 280px at 90% -30%,color-mix(in srgb,var(--accent-2) 11%,transparent),transparent 70%)}
.top-in{max-width:1320px;margin:0 auto}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
.top h1{font-family:Poppins,system-ui,sans-serif;font-weight:700;font-size:clamp(28px,4vw,42px);line-height:1.1;margin:0 0 10px;letter-spacing:-.02em;text-wrap:balance}
.top p{margin:0;color:var(--ink-dim);max-width:70ch}
.layout{max-width:1320px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:290px minmax(0,1fr);gap:40px}
.toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;padding:22px 4px 40px 0;font-size:14px}
.toc::-webkit-scrollbar{width:0;height:0}
.toc-title{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px 6px}
.toc ul{list-style:none;margin:0;padding:0}
.toc ul ul{padding-left:14px;border-left:1px solid var(--line);margin-left:9px}
.toc li{margin:1px 0}
.toc a{display:flex;gap:6px;align-items:baseline;color:var(--ink-dim);text-decoration:none;padding:3px 6px;border-radius:6px;line-height:1.35}
.toc a:hover,.toc a:focus-visible{color:var(--ink);background:var(--surface)}
.toc a[aria-current="true"]{color:var(--ink);background:var(--surface);box-shadow:inset 2px 0 0 var(--accent)}
.toc summary{list-style:none;display:flex;align-items:baseline;cursor:pointer}
.toc summary::-webkit-details-marker{display:none}
.toc summary::before{content:"▸";color:var(--ink-faint);width:12px;flex:none;font-size:11px;transition:transform .15s}
.toc details[open]>summary::before{transform:rotate(90deg)}
.toc summary a{flex:1}
.toc li:not(:has(details))>a{margin-left:12px}
.nav-doc>details>summary a{font-family:Poppins,sans-serif;font-weight:600;color:var(--ink);font-size:15px}
.nav-table a{font-family:"IBM Plex Mono",monospace;font-size:12.5px}
.nav-badge{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ground);background:var(--accent);border-radius:4px;padding:0 5px;flex:none}
main{min-width:0;padding:10px 0 60px}
.doc{padding-top:26px}
.doc+.doc{border-top:1px solid var(--line);margin-top:40px}
.doc-head h1{font-family:Poppins,sans-serif;font-weight:700;font-size:30px;margin:0 0 14px;letter-spacing:-.01em}
.doc-src{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--accent);margin:0 0 4px}
main h2{font-family:Poppins,sans-serif;font-weight:600;font-size:24px;margin:44px 0 10px;letter-spacing:-.01em;text-wrap:balance}
main h3{font-family:Poppins,sans-serif;font-weight:600;font-size:18px;margin:28px 0 6px}
main h2,main h3{position:relative}
.anchor{position:absolute;left:-.9em;color:var(--ink-faint);text-decoration:none;opacity:0;font-weight:400}
h2:hover .anchor,h3:hover .anchor{opacity:1}
main p,main li{max-width:74ch}
main p{margin:0 0 14px}
main ol,main ul{padding-left:22px}
main pre:not(.mermaid){background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;overflow-x:auto;font-size:13.5px;line-height:1.5}
main pre:not(.mermaid) code{background:none;padding:0}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);margin:0 0 20px}
.tablewrap table{border-collapse:collapse;width:100%;min-width:600px;font-size:14px}
.tablewrap th,.tablewrap td{text-align:left;padding:9px 13px;border-bottom:1px solid var(--line);vertical-align:top}
.tablewrap thead th{background:var(--surface-2);font-family:Poppins,sans-serif;font-weight:600;font-size:13px}
.tablewrap tbody tr:last-child td{border-bottom:0}
figure.plate{margin:18px 0 16px}
.plate-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.tag{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ground);background:var(--accent);padding:2px 8px;border-radius:5px}
.plate-meta{color:var(--ink-dim);font-size:13.5px}
.plate-body{background:var(--plate);border:1px solid var(--plate-line);border-radius:var(--radius);padding:16px;overflow-x:auto}
.plate-body pre.mermaid{margin:0;background:transparent;color:var(--plate-ink);font-size:12px;line-height:1.35;white-space:pre}
.dict{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;margin:0 0 26px}
.entity{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;scroll-margin-top:16px}
.entity:target{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 35%,transparent)}
.entity header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.entity h4{margin:0;font-family:"IBM Plex Mono",monospace;font-weight:500;font-size:15px;color:var(--accent)}
.entity-count{font-size:12px;color:var(--ink-faint)}
.cols{overflow-x:auto}
.cols table{border-collapse:collapse;width:100%;font-size:12.5px}
.cols td{padding:3px 6px 3px 0;vertical-align:top;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.cols tr:first-child td{border-top:0}
.c-name{font-family:"IBM Plex Mono",monospace;color:var(--ink);white-space:nowrap}
.c-type{font-family:"IBM Plex Mono",monospace;color:var(--ink-faint);white-space:nowrap}
.c-keys{white-space:nowrap}
.c-note{color:var(--ink-dim)}
.key{font-family:"IBM Plex Mono",monospace;font-size:10px;padding:0 4px;border-radius:3px;margin-right:3px;border:1px solid var(--line);color:var(--ink-dim)}
.key-pk{color:var(--ground);background:var(--accent);border-color:var(--accent)}
.key-fk{color:var(--accent-2);border-color:color-mix(in srgb,var(--accent-2) 50%,transparent)}
.rels{list-style:none;margin:8px 0 0;padding:8px 0 0;border-top:1px dashed var(--line);font-size:12.5px}
.rels li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;max-width:none}
.rel-card{font-family:"IBM Plex Mono",monospace;color:var(--ink-faint);min-width:58px}
.rels a{font-family:"IBM Plex Mono",monospace}
.rel-label{color:var(--ink-dim)}
.toc .nav-group{margin-top:16px}
.toc .nav-group:first-child{margin-top:0}
.nav-group>details>summary a{font-family:"IBM Plex Mono",monospace;font-weight:500;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.toc .nav-group>details>ul{border-left:0;margin-left:0;padding-left:4px}
.group-band{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin:72px 0 0;padding:14px 0 0;border-top:2px solid var(--accent);scroll-margin-top:16px}
main>.group-band:first-child{margin-top:26px}
.group-name{font-family:Poppins,sans-serif;font-weight:700;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.group-count{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-faint)}
.group-band+.doc{padding-top:14px}
main h4{font-family:Poppins,sans-serif;font-weight:600;font-size:16px;margin:24px 0 6px;position:relative}
main h5,main h6{font-family:Poppins,sans-serif;font-weight:600;font-size:15px;margin:20px 0 4px;color:var(--ink-dim);position:relative}
h4:hover .anchor,h5:hover .anchor,h6:hover .anchor{opacity:1}
main blockquote{margin:0 0 16px;padding:10px 16px;background:var(--surface);border-left:3px solid var(--accent);border-radius:0 var(--radius) var(--radius) 0;color:var(--ink-dim);max-width:78ch}
main blockquote p:last-child{margin-bottom:0}
main li:has(>input[type="checkbox"]){list-style:none;margin-left:-20px}
main input[type="checkbox"]{accent-color:var(--accent);margin:0 8px 0 0;vertical-align:-1px}
.doclink{text-decoration:none}
.doclink code{color:var(--accent)}
.doclink:hover code,.doclink:focus-visible code{text-decoration:underline}
footer{max-width:1320px;margin:0 auto;padding:20px;color:var(--ink-faint);font-size:13px;border-top:1px solid var(--line)}
@media (max-width:900px){.layout{grid-template-columns:1fr;gap:0}.toc{position:static;max-height:none;border-bottom:1px solid var(--line);padding:16px 0}.dict{grid-template-columns:1fr}.anchor{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// Підсвітка поточного пункту меню й згортання гілок. Без JS меню однаково
// повне й клікабельне — скрипт лише додає «де я», розкриває згорнуту гілку з
// таблицями і згортає пункт повторним кліком.
//
// Не IntersectionObserver: цілі вкладені одна в одну (документ містить
// розділ, розділ — картку таблиці), і спостерігач у смузі зверху бачить їх
// усі одночасно — перша версія підсвічувала весь документ замість таблиці.
// «Остання ціль у порядку документа, чий верх уже пройшов позначку» дає
// найглибший поточний пункт без жодних евристик.
//
// Згортання. Клік по посиланню всередині <summary> гілку не перемикає —
// клік забирає посилання, а не summary. Тому перший клік розкриває гілку й
// веде до розділу, а другий клік по тому ж пункті згортає її без переходу.
// Згорнуту руками гілку позначаємо data-closed, бо інакше підсвітка на
// найближчому ж скролі розкрила б її назад. Поки гілка згорнута, «де я»
// світить її заголовок, а не сховану всередині таблицю.
//
// Що розкрила підсвітка (data-spy), те вона ж і згортає, коли читач пішов
// далі: інакше з кожним прочитаним доком меню ставало б довшим. Розкрите
// руками лишається, як лишив читач. Власні перемикання скрипт позначає
// data-auto: toggle приходить асинхронно, і без позначки його не відрізнити
// від кліку людини.
const SPY = `
(function(){
  var toc = document.querySelector(".toc"); if (!toc) return;
  var links = {}; Array.prototype.forEach.call(toc.querySelectorAll("a[href^='#']"), function(a){ links[a.getAttribute("href").slice(1)] = a; });
  var targets = Object.keys(links).map(function(id){ return document.getElementById(id); }).filter(Boolean);
  var current = null, queued = false, lastClicked = null;
  function ownDetails(a){ var s = a.parentElement; return s && s.tagName === "SUMMARY" ? s.parentElement : null; }
  function setOpen(d, open){ if (d.open === open) return; d.setAttribute("data-auto", open ? "open" : "close"); d.open = open; }
  function mark(id){
    var a = id && links[id]; if (!a || id === current) return; current = id;
    var shown = a, el, path = [];
    for (el = a.parentElement; el && el !== toc; el = el.parentElement)
      if (el.tagName === "DETAILS" && el !== ownDetails(a) && !el.open && el.hasAttribute("data-closed")) shown = el.querySelector("summary a");
    for (el = shown.parentElement; el && el !== toc; el = el.parentElement) if (el.tagName === "DETAILS") path.push(el);
    if (shown === a)
      path.forEach(function(d){ if (!d.open && !d.hasAttribute("data-closed")) { setOpen(d, true); d.setAttribute("data-spy", ""); } });
    Array.prototype.forEach.call(toc.querySelectorAll("details[data-spy]"), function(d){
      if (path.indexOf(d) === -1) { d.removeAttribute("data-spy"); setOpen(d, false); }
    });
    Array.prototype.forEach.call(toc.querySelectorAll("a[aria-current]"), function(x){ x.removeAttribute("aria-current"); });
    shown.setAttribute("aria-current", "true");
    if (getComputedStyle(toc).position === "sticky") shown.scrollIntoView({ block: "nearest" });
  }
  function update(){
    queued = false;
    var line = 120, found = null;
    for (var i = 0; i < targets.length; i++) if (targets[i].getBoundingClientRect().top <= line) found = targets[i];
    mark(found ? found.id : targets[0] && targets[0].id);
  }
  toc.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href^='#']"); if (!a) return;
    var d = ownDetails(a);
    if (d && d.open && lastClicked === a) {
      e.preventDefault();
      d.open = false;
      lastClicked = null;
      return;
    }
    if (d) d.open = true;
    lastClicked = a;
  });
  // toggle не спливає, тому ловимо на фазі захоплення. Сюди ж приходить і
  // клік по стрілці ▸, який браузер перемикає сам, без нашого обробника.
  toc.addEventListener("toggle", function(e){
    var d = e.target; if (d.tagName !== "DETAILS") return;
    var auto = d.getAttribute("data-auto"); d.removeAttribute("data-auto");
    if (auto && auto === (d.open ? "open" : "close")) return;
    d.removeAttribute("data-spy");
    if (d.open) d.removeAttribute("data-closed"); else d.setAttribute("data-closed", "");
    current = null; update();
  }, true);
  window.addEventListener("scroll", function(){ if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  // location.hash віддає кирилицю закодованою (%D1%96…), а ключі links —
  // як у href. Без декодування mark() не знаходив пункт і лише збивав current.
  window.addEventListener("hashchange", function(){
    var id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    mark(id);
  });
  update();
})();
`;

function renderPage(model, { artifact }) {
  const sha = createHash("sha256");
  sha.update(model.reg.md);
  model.docs.forEach((d) => sha.update(d.md));
  const stamp = sha.digest("hex").slice(0, 7);
  const nDocs = model.docs.length, nGroups = model.groups.length;
  const nav = `<nav class="toc" aria-label="Зміст"><p class="toc-title">Зміст</p><ul>${model.groups.map((g) => navHTML(g.nav)).join("")}</ul></nav>`;
  const body = model.groups
    .map((g) => {
      const band = `<div class="group-band" id="${g.id}"><span class="group-name">${esc(g.title)}</span><span class="group-count">${g.docs.length} ${plural(g.docs.length, ["документ", "документи", "документів"])}</span></div>`;
      return [band, ...g.docs.map((d) => renderDoc(d, model))].join("\n");
    })
    .join("\n");
  const archived = model.reg.archived.map((f) => `<code>${esc(f)}</code>`).join(", ");
  const mermaidTags = artifact
    ? "" // хост claude.ai малює <pre class="mermaid"> сам — бібліотеку не вантажимо
    : `<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/${MERMAID_VERSION}/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, securityLevel: "strict" });</script>`;

  return `<!-- ЗГЕНЕРОВАНО scripts/build-data-map.mjs з доків реєстру ${REGISTRY}. Не редагувати: правити markdown і запускати npm run docs:map. -->
<title>Карта даних extrovert.cafe</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLE}</style>
<header class="top"><div class="top-in">
  <p class="eyebrow">extrovert.cafe · джерело ${stamp}</p>
  <h1>Карта даних і документації</h1>
  <p>Уся чинна документація проєкту однією сторінкою: ${nDocs} ${plural(nDocs, ["документ", "документи", "документів"])} у ${nGroups} ${nGroups === 1 ? "групі" : "групах"}, від схеми Postgres і карти сервісів до економіки гри й деплою на малину. Склад і порядок задає реєстр <code>${REGISTRY}</code>. Текст сюди не копіюється: сторінка збирається з markdown командою <code>npm run docs:map</code>.</p>
</div></header>
<div class="layout">
${nav}
<main>
${body}
</main>
</div>
<footer>Хеш джерел ${stamp} — якщо він не збігається з поточними доками, сторінка застаріла.${archived ? ` В архіві й тут не показано: ${archived}.` : ""}</footer>
${mermaidTags}
<script>${SPY}</script>
`;
}

// ── запуск ────────────────────────────────────────────────────────────────
function build({ artifact = false } = {}) {
  const model = buildModel();
  return { html: renderPage(model, { artifact }), warnings: model.warnings, docs: model.docs.length };
}

const readStdin = () =>
  new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    if (process.stdin.isTTY) resolve("");
  });

const args = process.argv.slice(2);
const outPath = path.join(ROOT, OUT);

if (args.includes("--hook")) {
  // Хук стріляє на КОЖЕН Write/Edit — для чужих файлів тихо виходимо.
  let payload = {};
  try { payload = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const file = payload?.tool_input?.file_path || payload?.tool_response?.filePath;
  if (!file) process.exit(0);
  // Стріляємо на реєстр, на будь-який док у docs/ (щоб новий файл одразу дав
  // попередження «нема в реєстрі») і на доки реєстру поза docs/ (pi/README.md).
  const isDocsMd = /\.md$/i.test(file) && samePath(path.dirname(path.resolve(file)), path.join(ROOT, "docs"));
  const inRegistry = () => [...readRegistry().listed].some((f) => samePath(file, path.join(ROOT, f)));
  if (!isDocsMd && !inRegistry()) process.exit(0);
  try {
    const { html, warnings, docs } = build();
    writeFileSync(outPath, html);
    const warn = warnings.length ? ` Попередження (${warnings.length}): ${warnings.join("; ")}` : "";
    process.stdout.write(
      JSON.stringify({
        systemMessage: `Карту даних перегенеровано → code/${OUT}.${warn}`,
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext:
            `code/${OUT} перегенеровано з ${docs} доків реєстру ${REGISTRY}; закомітити разом із доком.` +
            " Artifact на claude.ai сам не оновлюється — перепублікувати через --artifact, якщо сторінку треба показати." +
            warn,
        },
      }),
    );
  } catch (e) {
    process.stdout.write(JSON.stringify({ systemMessage: `Карту даних НЕ перегенеровано: ${e.message}` }));
  }
  process.exit(0);
}

if (args.includes("--check")) {
  const { html, warnings } = build();
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8").replace(/\r\n/g, "\n") : "";
  warnings.forEach((w) => console.error(`увага: ${w}`));
  if (existing !== html) {
    console.error(`${OUT} застарів — запустіть: npm run docs:map`);
    process.exit(1);
  }
  if (warnings.length) process.exit(1);
  console.log(`${OUT} актуальний`);
  process.exit(0);
}

const artIdx = args.indexOf("--artifact");
if (artIdx !== -1) {
  const target = args[artIdx + 1];
  if (!target) { console.error("--artifact потребує шлях до файла"); process.exit(2); }
  const { html, warnings } = build({ artifact: true });
  writeFileSync(path.resolve(target), html);
  warnings.forEach((w) => console.error(`увага: ${w}`));
  console.log(`артефакт-варіант → ${path.resolve(target)}`);
  process.exit(0);
}

const { html, warnings } = build();
writeFileSync(outPath, html);
warnings.forEach((w) => console.error(`увага: ${w}`));
console.log(`${OUT} перегенеровано${warnings.length ? `, попереджень: ${warnings.length}` : ""}`);
