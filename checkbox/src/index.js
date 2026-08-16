// Приймач вебхуків ПРРО Checkbox.
// ВАЖЛИВО: підпис перевіряти завжди — інакше будь-хто накрутить нам «продажі».
// Формула з документації: base64(HmacSHA256(secret, тіло_UTF8)).
import Fastify from "fastify";
import crypto from "node:crypto";

const app = Fastify({ logger: true });
const PORT = process.env.PORT || 3003;
const SECRET = process.env.CHECKBOX_WEBHOOK_KEY || "";

app.get("/healthz", async () => ({ ok: true, service: "checkbox" }));

app.post("/webhook/checkbox", {
  config: { rawBody: true }
}, async (req, reply) => {
  const raw = req.rawBody ?? JSON.stringify(req.body);
  const sig = req.headers["x-signature"] || req.headers["X-Signature"];
  const mine = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  if (!SECRET || !sig || !timingSafeEq(String(sig), mine)) {
    req.log.warn("підпис не збігся");
    return reply.code(401).send({ error: "bad signature" });
  }
  // TODO ідемпотентність за receipt.id, запис у Postgres, publish у Redis
  return { ok: true };
});

function timingSafeEq(a, b) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

app.listen({ port: PORT, host: "0.0.0.0" });
