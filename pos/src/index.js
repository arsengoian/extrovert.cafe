// Worker POS-кіоска.
//
// URL несе ІДЕНТИФІКАТОР ТОЧКИ від самого початку — щоб не переробляти,
// коли точок стане більше однієї:
//
//   /                             → 302 на точку за замовчанням
//   /p/<point>                    → сторінка кіоска
//   /api/v1/points/<point>/menu   → меню точки з R2 (ключ points/<point>/menu.json)
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
