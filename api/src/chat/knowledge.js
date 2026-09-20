// База знань для чату: публічні пояснення правил із api/data/knowledge/*.json.
//
// Пошук працює у двох режимах:
//   • вектори — якщо поруч лежить embeddings.json (робить bun run kb:embed);
//   • слова — якщо ні.
// Другий режим потрібен не «про всяк випадок»: локально в розробника
// зазвичай немає ключа OpenAI, а чат має лишатись перевірюваним. Обидва
// шляхи повертають однакову структуру, тому решта коду про це не знає.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KB_DIR = path.join(HERE, "..", "..", "data", "knowledge");
const EMBEDDINGS = path.join(KB_DIR, "embeddings.json");

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

function load() {
  const docs = [];
  for (const file of readdirSync(KB_DIR).filter((f) => f.endsWith(".json") && f !== "embeddings.json")) {
    const parsed = JSON.parse(readFileSync(path.join(KB_DIR, file), "utf8"));
    for (const doc of parsed.docs ?? []) docs.push({ ...doc, source: file.replace(".json", "") });
  }
  return docs;
}

export const documents = load();

const vectors = existsSync(EMBEDDINGS)
  ? new Map(Object.entries(JSON.parse(readFileSync(EMBEDDINGS, "utf8")).vectors ?? {}))
  : new Map();

export const hasVectors = vectors.size > 0;

// Текст документа так, як його бачать і вектори, і слова — щоб пошук і
// заливка в OpenAI не розходились.
export const plainText = (doc) => `${doc.title}\n${(doc.tags ?? []).join(", ")}\n${doc.body}`;

// ── словесний пошук ────────────────────────────────────────────────────
// Українська словозміна ловиться обрізанням до основи: «монети», «монетами»
// і «монет» дають той самий ключ. Це груба, але чесна евристика — від
// точного збігу словоформ користі було б менше.
const stem = (w) => w.slice(0, Math.max(4, w.length - 2));
const tokens = (text) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length > 2).map(stem);

function keywordSearch(query, k) {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  const scored = documents.map((doc) => {
    const title = new Set(tokens(doc.title));
    const tags = new Set(tokens((doc.tags ?? []).join(" ")));
    const body = new Set(tokens(doc.body));
    let score = 0;
    for (const token of q) {
      if (tags.has(token)) score += 3;
      if (title.has(token)) score += 2;
      if (body.has(token)) score += 1;
    }
    return { doc, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

// ── векторний пошук ────────────────────────────────────────────────────
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

export async function embed(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("немає OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function vectorSearch(query, k) {
  const [q] = await embed([query]);
  // Вектори OpenAI нормовані, тому скалярного добутку досить — косинус
  // рахувати нема потреби.
  const scored = documents
    .map((doc) => ({ doc, score: vectors.has(doc.id) ? dot(q, vectors.get(doc.id)) : -1 }))
    .filter((s) => s.score > 0.2);
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

export async function search(query, k = 4) {
  if (hasVectors && process.env.OPENAI_API_KEY) {
    try {
      return await vectorSearch(query, k);
    } catch {
      // Мережа впала — краще гірший пошук, ніж мовчазний чат.
    }
  }
  return keywordSearch(query, k);
}
