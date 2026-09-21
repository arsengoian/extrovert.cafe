// Сервер подій. Підписує клієнта на його канал у Redis і пересилає те, що
// туди публікує scheduler з outbox (docs/services.md §4, db-schema §0).
//
// Два правила з доків, які тут видно в коді:
//   * ws НЕ підписує токени, лише перевіряє — приватного ключа тут немає;
//   * токен їде в Sec-WebSocket-Protocol, а не в URL: URL осідають у логах.
import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { WebSocketServer } from "ws";
import { onShutdown } from "@extrovert/lib/shutdown.js";
import { redisClient } from "@extrovert/lib/redis.js";

const PORT = Number(process.env.PORT || 3002);
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6389";

// Публічний ключ: у проді приходить змінною, локально виводимо з приватного
// (в одній машині обидва все одно лежать поруч).
function publicKey() {
  const pub = process.env.JWT_PUBLIC_KEY;
  const priv = process.env.JWT_PRIVATE_KEY;
  const clean = (pem) => pem.replace(/\\n/g, "\n").replace(/\r/g, "").trim() + "\n";
  if (pub) return createPublicKey(clean(pub));
  if (priv) return createPublicKey(clean(priv));
  return null;
}

const KEY = publicKey();

function claimsFrom(token) {
  if (!KEY) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const ok = verify(null, Buffer.from(`${h}.${p}`), KEY, Buffer.from(s, "base64url"));
  if (!ok) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// Канал з sub: user:<uuid> слухає телефон, point:<id> — кіоск.
const channelFor = (sub) => (/^(user|point):/.test(sub) ? sub : null);

const server = createServer((req, res) => {
  if (req.url === "/healthz") return res.writeHead(200).end('{"ok":true}');
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, handleProtocols: (protocols) => {
  // Клієнт шле два підпротоколи: наш маркер і сам токен.
  return protocols.has("extrovert.v1") ? "extrovert.v1" : false;
} });

const sub = redisClient();
const rooms = new Map();        // канал → Set(ws)

sub.on("pmessage", (_pattern, channel, payload) => {
  const room = rooms.get(channel);
  if (!room) return;
  for (const socket of room) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
});
await sub.psubscribe("user:*", "point:*");

wss.on("connection", (socket, req) => {
  const offered = (req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim());
  const token = offered.find((p) => p.startsWith("jwt."))?.slice(4);
  const claims = claimsFrom(token);
  const channel = claims && channelFor(claims.sub);

  if (!channel) {
    socket.close(4401, "unauthorized");
    return;
  }

  if (!rooms.has(channel)) rooms.set(channel, new Set());
  rooms.get(channel).add(socket);
  socket.send(JSON.stringify({ event: "hello", channel }));

  socket.on("close", () => {
    const room = rooms.get(channel);
    room?.delete(socket);
    if (room && room.size === 0) rooms.delete(channel);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ws на :${PORT}, redis ${REDIS_URL}${KEY ? "" : " — БЕЗ ключа: усі зʼєднання відхилятимуться"}`);
});

// Зупинка. Довге зʼєднання не можна просто обірвати: для застосунку це
// виглядає як мережевий збій, і він мовчки перестає отримувати події доти,
// доки користувач не смикне екран. Тому кожному сокету надсилається 1001
// «going away» — за специфікацією це сигнал «сервер іде, перепідключись», і
// клієнт іде на новий контейнер одразу.
onShutdown({
  "нові зʼєднання": () => new Promise((resolve) => server.close(resolve)),
  "відкриті сокети": async () => {
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.close(1001, "redeploy");
    }
    // Півсекунди на те, щоб кадр закриття пішов у мережу: close() лише
    // ставить його в чергу.
    await new Promise((r) => setTimeout(r, 500));
    for (const socket of wss.clients) socket.terminate();
  },
  "redis": () => sub.quit(),
  // console як логер: тут немає ні pino, ні makeLog — сервіс пише в stdout
  // напряму, і зупинка має бути видна так само, як старт.
}, { log: console, timeoutMs: 15_000 });
