// База знань чату: перевірка, ембединги й заливка в OpenAI.
//
//   bun run kb:check    — що лежить у базі, дублі id, довжини, пошук
//   bun run kb:embed    — рахує вектори в backend/api/data/knowledge/embeddings.json
//   bun run kb:store    — створює vector store в OpenAI й друкує рядок OPENAI_VECTOR_STORE для .env
//   bun run kb:push     — заливає документи у vector store OpenAI
//   bun run kb:ask "…"  — що знайде пошук на такий запит
//
// Тексти живуть у репозиторії (backend/api/data/knowledge/*.json) і саме звідси
// їдуть в OpenAI — щоб «те, що знає кавенятко» можна було прочитати в
// гіті, а не лише в чужій панелі.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { documents, embed, plainText, search, KB_DIR, EMBEDDING_MODEL } from "../backend/api/src/chat/knowledge.js";

const [command, ...rest] = process.argv.slice(2);

const key = () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error("немає OPENAI_API_KEY у .env — без нього ні ембедингів, ні заливки");
    process.exit(1);
  }
  return process.env.OPENAI_API_KEY;
};

async function check() {
  const ids = new Map();
  let problems = 0;
  for (const doc of documents) {
    if (ids.has(doc.id)) { console.log(`✗ дубль id: ${doc.id} (${ids.get(doc.id)} і ${doc.source})`); problems++; }
    ids.set(doc.id, doc.source);
    if (!doc.tags?.length) { console.log(`✗ без тегів: ${doc.id}`); problems++; }
    if (doc.body.length < 120) { console.log(`✗ надто коротко (${doc.body.length}): ${doc.id}`); problems++; }
    if (doc.body.length > 1200) { console.log(`· довгий документ (${doc.body.length}): ${doc.id} — подумай розбити`); }
  }
  const bySource = documents.reduce((m, d) => ({ ...m, [d.source]: (m[d.source] ?? 0) + 1 }), {});
  console.log(`документів: ${documents.length}`, bySource);
  console.log(problems ? `проблем: ${problems}` : "✓ база знань ціла");
  if (problems) process.exit(1);
}

async function embedAll() {
  key();
  const vectors = {};
  // Пачками, щоб не впертись у ліміт розміру запиту й побачити прогрес.
  for (let i = 0; i < documents.length; i += 16) {
    const batch = documents.slice(i, i + 16);
    const result = await embed(batch.map(plainText));
    batch.forEach((doc, n) => { vectors[doc.id] = result[n].map((v) => Math.round(v * 1e6) / 1e6); });
    console.log(`  ${Math.min(i + 16, documents.length)} / ${documents.length}`);
  }
  const out = path.join(KB_DIR, "embeddings.json");
  writeFileSync(out, `${JSON.stringify({
    $comment: "Згенеровано bun run kb:embed. Руками не редагувати; після зміни текстів перерахувати.",
    model: EMBEDDING_MODEL,
    generated: new Date().toISOString().slice(0, 10),
    vectors,
  })}\n`);
  console.log(`✓ ${out}: ${Object.keys(vectors).length} векторів`);
}

// Заливка у vector store: кожен документ — окремий файл, щоб file_search
// повертав його цілком і з назвою.
async function push() {
  const token = key();
  const store = process.env.OPENAI_VECTOR_STORE;
  if (!store) {
    console.error("немає OPENAI_VECTOR_STORE у .env — створи сховище: bun run kb:store");
    process.exit(1);
  }
  const api = (p, init) => fetch(`https://api.openai.com/v1${p}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });

  for (const doc of documents) {
    const body = new FormData();
    body.append("purpose", "assistants");
    body.append("file", new Blob([`# ${doc.title}\n\n${doc.body}\n\nТеги: ${(doc.tags ?? []).join(", ")}\n`],
      { type: "text/markdown" }), `${doc.id}.md`);
    const upload = await api("/files", { method: "POST", body });
    if (!upload.ok) { console.error(`✗ ${doc.id}: ${await upload.text()}`); continue; }
    const file = await upload.json();
    const attach = await api(`/vector_stores/${store}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.id }),
    });
    console.log(attach.ok ? `✓ ${doc.id}` : `✗ ${doc.id}: ${await attach.text()}`);
  }
}

// Сховище створюється один раз на оточення: у назві APP_ENV, щоб локальне
// й бойове не змішались, якщо ключ OpenAI в них спільний. id — не секрет
// (без ключа він нічого не дає), тож друкуємо його готовим рядком для .env.
async function store() {
  const token = key();
  const current = process.env.OPENAI_VECTOR_STORE;
  if (current) {
    // Значення не друкуємо: сюди легко помилково вставити сам API-ключ —
    // сусідній рядок у .env, — і тоді він опинився б у виводі.
    console.error(current.startsWith("sk-")
      ? "в OPENAI_VECTOR_STORE схоже лежить API-ключ (sk-…): перенеси його в OPENAI_API_KEY, а цей рядок очисти"
      : "OPENAI_VECTOR_STORE уже заданий — друге сховище не створюю");
    process.exit(1);
  }
  if (token.startsWith("vs_")) {
    console.error("в OPENAI_API_KEY лежить id сховища (vs_…), а не ключ — переплутані рядки в .env");
    process.exit(1);
  }
  const name = `extrovert-kb-${process.env.APP_ENV || "local"}`;
  const res = await fetch("https://api.openai.com/v1/vector_stores", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    console.error(`✗ ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const vs = await res.json();
  console.log(`Сховище «${name}» створено. Додай у .env:\n`);
  console.log(`OPENAI_VECTOR_STORE=${vs.id}`);
  console.log("\nДалі — bun run kb:push, щоб залити туди базу знань.");
}

async function ask() {
  const query = rest.join(" ");
  if (!query) { console.error("що питаємо? bun run kb:ask \"скільки коштує скринька\""); process.exit(1); }
  const found = await search(query, 5);
  for (const { doc, score } of found) {
    console.log(`${score.toFixed(2)}  ${doc.id} — ${doc.title}`);
  }
  if (!found.length) console.log("нічого не знайшлось");
}

const commands = { check, embed: embedAll, store, push, ask };
if (!commands[command]) {
  console.error("команди: check | embed | store | push | ask <запит>");
  process.exit(1);
}
await commands[command]();
