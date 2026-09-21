// Умови, приватність і контакт підтримки. Тексти — у backend/api/data/legal, а не
// в клієнті: нова редакція не має вимагати релізу застосунку, а дата
// редакції має бути одна для всіх, хто зараз у грі.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../errors.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "..", "data", "legal");

const docs = Object.fromEntries(
  readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const doc = JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
    return [doc.id, doc];
  })
);

// Редакція умов, яку приймає гравець на екрані «Твій нікнейм»: пишеться в
// users.terms_version, щоб знати, з якою редакцією він погодився.
export const TERMS_VERSION = docs.terms?.updated ?? null;

export default async function routes(app) {
  app.get("/legal", async () => ({
    docs: Object.values(docs).map(({ id, title, updated }) => ({ id, title, updated })),
    support: {
      title: "Підтримка",
      body: "Усе, що стосується точок і напоїв — через «Повідомити про проблему»: скарга приходить команді "
        + "разом із часом і номером точки. Питання щодо акаунта й даних — тим самим шляхом, "
        + "у тексті напиши «акаунт».",
    },
  }));

  app.get("/legal/:id", async (req) => {
    const doc = docs[String(req.params.id)];
    if (!doc) fail(404, "no_such_doc");
    return doc;
  });
}
