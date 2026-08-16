// Сервер подій. Кіоск слухає свою точку, телефон — свій акаунт.
// Джерело подій — Redis pub/sub, куди пише checkbox.
import { WebSocketServer } from "ws";
const PORT = process.env.PORT || 3002;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (sock, req) => {
  const m = String(req.url || "").match(/^\/v1\/points\/([a-z0-9][a-z0-9-]{1,30})$/);
  if (!m) { sock.close(1008, "bad channel"); return; }
  sock.send(JSON.stringify({ type: "hello", point: m[1] }));
  // TODO підписка на Redis-канал point:<id>
});

console.log(`ws на :${PORT}`);
