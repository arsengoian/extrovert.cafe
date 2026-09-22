// База знань чату: перевірка, ембединги й заливка в OpenAI.
//
//   make kb-check       — що лежить у базі, дублі id, довжини, пошук
//   make kb-embed       — рахує вектори в backend/api/data/knowledge/embeddings.json
//   make kb-store       — створює vector store в OpenAI й друкує рядок OPENAI_VECTOR_STORE для .env
//   make kb-push        — приводить vector store у відповідність до репозиторію
//   make kb-ask Q="…"   — що знайде пошук на такий запит
//
// CI (робота knowledge у deploy.yml) робить kb:check і kb:push через
// bun run — make на раннері ні до чого.
//
// Тексти живуть у репозиторії (backend/api/data/knowledge/*.json) і саме звідси
// їдуть в OpenAI — щоб «те, що знає кавенятко» можна було прочитати в
// гіті, а не лише в чужій панелі.
import { createHash } from "node:crypto";
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
// повертав його цілком і з назвою. Сховище дзеркалить репозиторій і належить
// базі знань цілком. В атрибутах файла — id документа й хеш тексту, тож
// повторний прогін (CI робить його на кожен пуш у main) заливає лише змінене,
// а файли переписаних і видалених документів прибирає: інакше file_search
// знаходив би стару й нову версію поруч.
async function push() {
  const token = key();
  const store = process.env.OPENAI_VECTOR_STORE;
  if (!store) {
    console.error("немає OPENAI_VECTOR_STORE у .env — створи сховище: make kb-store");
    process.exit(1);
  }
  const api = async (p, init = {}, { missingOk = false } = {}) => {
    const res = await fetch(`https://api.openai.com/v1${p}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    if (missingOk && res.status === 404) return null;
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const wanted = new Map(documents.map((doc) => {
    const text = `# ${doc.title}\n\n${doc.body}\n\nТеги: ${(doc.tags ?? []).join(", ")}\n`;
    return [doc.id, { doc, text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16) }];
  }));

  // Що вже лежить у сховищі — сторінками по 100.
  const present = [];
  for (let after = ""; ;) {
    const page = await api(`/vector_stores/${store}/files?limit=100${after && `&after=${after}`}`);
    present.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    after = page.data.at(-1).id;
  }

  // Актуальна копія документа — та, що з тим самим хешем і не впала при
  // індексації. Решта (старі версії, дублі, файли без наших атрибутів) — під
  // видалення.
  const fresh = new Set();
  const stale = [];
  for (const file of present) {
    const want = wanted.get(file.attributes?.doc);
    const alive = file.status === "completed" || file.status === "in_progress";
    if (want && file.attributes.hash === want.hash && alive && !fresh.has(want.doc.id)) fresh.add(want.doc.id);
    else stale.push(file);
  }

  let added = 0, removed = 0;
  const failed = new Set();
  for (const { doc, text, hash } of wanted.values()) {
    if (fresh.has(doc.id)) continue;
    try {
      const body = new FormData();
      body.append("purpose", "assistants");
      body.append("file", new Blob([text], { type: "text/markdown" }), `${doc.id}.md`);
      const file = await api("/files", { method: "POST", body });
      try {
        await api(`/vector_stores/${store}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: file.id, attributes: { doc: doc.id, hash } }),
        });
      } catch (e) {
        await api(`/files/${file.id}`, { method: "DELETE" }, { missingOk: true }).catch(() => {});
        throw e;
      }
      console.log(`+ ${doc.id}`);
      added++;
    } catch (e) {
      console.error(`✗ ${doc.id}: ${e.message}`);
      failed.add(doc.id);
    }
  }

  // Прибираємо вже після заливки: пошук не лишається без документа навіть на
  // мить, а якщо нова версія не залилась — стара краща, ніж нічого.
  for (const file of stale) {
    const doc = file.attributes?.doc;
    if (failed.has(doc)) continue;
    try {
      await api(`/vector_stores/${store}/files/${file.id}`, { method: "DELETE" }, { missingOk: true });
      await api(`/files/${file.id}`, { method: "DELETE" }, { missingOk: true });
      console.log(`− ${doc ?? file.id}`);
      removed++;
    } catch (e) {
      console.error(`✗ прибрати ${doc ?? file.id}: ${e.message}`);
      failed.add(doc ?? file.id);
    }
  }

  console.log(`залито ${added}, прибрано ${removed}, без змін ${fresh.size}`);
  if (failed.size) {
    console.error(`✗ не вдалось: ${failed.size} — повторний прогін дозальє`);
    process.exit(1);
  }
  console.log("✓ сховище збігається з репозиторієм");
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
  console.log("\nДалі — make kb-push, щоб залити туди базу знань.");
}

async function ask() {
  const query = rest.join(" ");
  if (!query) { console.error("що питаємо? make kb-ask Q=\"скільки коштує скринька\""); process.exit(1); }
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
