// REST-бекенд. Каркас: маршрути під схему з docs/urls.md.
import Fastify from "fastify";
const app = Fastify({ logger: true });
const PORT = process.env.PORT || 3001;

app.get("/healthz", async () => ({ ok: true, service: "api" }));

// TODO меню з Postgres; поки віддає pos прямо з R2
app.get("/api/v1/points/:point/menu", async (req, reply) =>
  reply.code(501).send({ error: "not implemented", point: req.params.point }));

app.get("/api/v1/me", async (_, reply) => reply.code(501).send({ error: "not implemented" }));
app.get("/api/v1/me/plants", async (_, reply) => reply.code(501).send({ error: "not implemented" }));

app.listen({ port: PORT, host: "0.0.0.0" });
