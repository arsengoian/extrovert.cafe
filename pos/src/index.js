// Worker POS-кіоска.
//
// URL несе ІДЕНТИФІКАТОР ТОЧКИ від самого початку — щоб не переробляти,
// коли точок стане більше однієї:
//
//   /                             → 302 на точку за замовчанням
//   /p/<point>                    → сторінка кіоска
//   /api/v1/points/<point>/menu   → меню точки з R2 (ключ points/<point>/menu.json)
//   /releases/pi/<файл>           → релізи стеку малини з R2 (pi/stack/updater.sh)
//   /healthz                      → пінг
//
// Поки бекенда немає, меню лежить у R2. Коли зʼявиться api-сервіс,
// цей роут стане проксі — контракт URL не зміниться.

const DEFAULT_POINT = "kyiv-01";
const LEGACY_KEY = "prices.json";               // до переїзду на points/<id>/menu.json
const POINT_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;   // без слешів і крапок

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const def = (env.DEFAULT_POINT || DEFAULT_POINT);

    if (p === "/healthz") {
      return json({ ok: true, ts: new Date().toISOString() });
    }

    // ── меню точки ──
    const m = p.match(/^\/api\/v1\/points\/([^/]+)\/menu$/);
    if (m) {
      const point = decodeURIComponent(m[1]);
      if (!POINT_RE.test(point)) return json({ error: "bad point id" }, 400);
      let obj = await env.PRICES.get(`points/${point}/menu.json`);
      let legacy = false;
      if (!obj) { obj = await env.PRICES.get(LEGACY_KEY); legacy = true; }
      if (!obj) return json({ error: `меню для точки ${point} не знайдено` }, 404);
      return new Response(await obj.text(), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, max-age=0",   // кіоск тягне раз на хвилину
          "access-control-allow-origin": "*",
          "x-point": point,
          "x-legacy-key": legacy ? "1" : "0",
          "x-updated": obj.uploaded ? obj.uploaded.toISOString() : ""
        }
      });
    }

    // ── релізи для апдейтера на точці ──
    // Маніфест і архіви кладе в R2 людина (docs/raspberry-pi.md, «Деплой»).
    // Обидва заголовки, які апдейтер шле, тут мусять працювати: If-None-Match
    // → 304, щоб раз на 15 хвилин не качати маніфест заново, і Range → 206,
    // бо curl -C - докачує обірваний архів на мобільному каналі.
    const rel = p.match(/^\/releases\/pi\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/);
    if (rel) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405);
      const obj = await env.PRICES.get(`releases/pi/${rel[1]}`, {
        onlyIf: request.headers,
        range: request.headers,
      });
      if (!obj) return json({ error: `${rel[1]} не знайдено` }, 404);
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("accept-ranges", "bytes");
      // Маніфест не кешуємо ніде: закешована стара версія = точка, яка
      // «не бачить» релізу. Архіви незмінні (імʼя містить версію).
      headers.set("cache-control", rel[1] === "manifest.json" ? "no-store" : "public, max-age=31536000, immutable");
      // onlyIf не пройшов → R2 віддає метадані без тіла.
      if (!("body" in obj)) return new Response(null, { status: 304, headers });
      const body = request.method === "HEAD" ? null : obj.body;
      if (obj.range && request.headers.has("range")) {
        const start = obj.range.offset ?? 0;
        const len = obj.range.length ?? obj.size - start;
        headers.set("content-range", `bytes ${start}-${start + len - 1}/${obj.size}`);
        headers.set("content-length", String(len));
        return new Response(body, { status: 206, headers });
      }
      headers.set("content-length", String(obj.size));
      return new Response(body, { headers });
    }

    // ── старий роут: лишаємо, поки Pi не перепрошитий на новий URL ──
    if (p === "/api/prices") {
      return Response.redirect(`${url.origin}/api/v1/points/${def}/menu`, 308);
    }

    // ── сторінка кіоска ──
    if (p === "/" || p === "") {
      return Response.redirect(`${url.origin}/p/${def}`, 302);
    }
    const pp = p.match(/^\/p\/([^/]+)\/?$/);
    if (pp) {
      if (!POINT_RE.test(decodeURIComponent(pp[1]))) return json({ error: "bad point id" }, 400);
      // віддаємо index.html; сама сторінка визначить точку з location.pathname
      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
    }

    return env.ASSETS.fetch(request);
  }
};

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}
