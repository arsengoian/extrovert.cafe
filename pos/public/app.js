/* EXTROVERT.CAFE — кіоск меню.
   Навмисно ES5 без стрілок, шаблонних рядків і fetch:
   має працювати на старому Chromium (Raspberry Pi 1 / Raspbian 9). */
(function () {
  "use strict";

  /* Ідентифікатор точки береться з URL: /p/<point>.
     Так один білд обслуговує будь-яку кількість точок, і кеш у localStorage
     теж розділений — інакше друга точка показала б чужі ціни. */
  var POINT = (function () {
    var m = String(location.pathname).match(/^\/p\/([a-z0-9][a-z0-9-]{1,30})\/?$/);
    return m ? m[1] : "kyiv-01";
  })();
  var API = "/api/v1/points/" + POINT + "/menu";

  /* Режими для замірів на слабкому залізі. Усе через URL, щоб на точці
     нічого не перезбирати: ?anim=0..4 · ?hud=1 · ?gpu=1
       anim 0 нічого · 1 поява · 2 +дихання · 3 +пара · 4 +блиск і пульс
     DEFAULT_ANIM — те, що поїде в прод. Піднімати тільки після заміру на Pi. */
  var DEFAULT_ANIM = 2;
  function qs(name, dflt) {
    var m = String(location.search).match(new RegExp("[?&]" + name + "=([^&]*)"));
    return m ? m[1] : dflt;
  }
  var ANIM = parseInt(qs("anim", String(DEFAULT_ANIM)), 10);
  if (isNaN(ANIM) || ANIM < 0) ANIM = 0;
  if (ANIM > 4) ANIM = 4;
  var HUD = qs("hud", "0") === "1";
  var GPU = qs("gpu", "0") === "1";

  /* Класи режимів тримаємо окремо від теми: render() перезаписує className
     цілком, і без цього анімації злітали б на кожному оновленні цін. */
  function modeClasses() {
    var c = ANIM > 0 ? "anim" + ANIM : "";
    if (HUD) c += " hud";
    if (GPU) c += " gpu";
    return c;
  }
  var LS = "extrovert.menu." + POINT;
  var refreshSec = 60;      // перечитування цін
  var reloadSec = 3600;     // повне перезавантаження сторінки
  var lastHash = null;

  /* ---------- масштабування сцени під будь-який екран ---------- */
  function fit() {
    var st = document.getElementById("stage");
    var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    st.style.transform = "scale(" + k + ")";
    st.style.left = Math.round((window.innerWidth - 1920 * k) / 2) + "px";
    st.style.top = Math.round((window.innerHeight - 1080 * k) / 2) + "px";
  }

  /* ---------- мережа ---------- */
  function getJSON(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open("GET", url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), true);
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) {
        try { ok(JSON.parse(x.responseText)); }
        catch (e) { fail("bad json"); }
      } else { fail("http " + x.status); }
    };
    x.ontimeout = function () { fail("timeout"); };
    x.onerror = function () { fail("network"); };
    x.send();
  }

  var isLight = false, isStale = false;
  function paintBody() {
    document.body.className =
      modeClasses() + (isLight ? " light" : "") + (isStale ? " stale" : "");
  }
  function stale(on) { isStale = on; paintBody(); }

  /* ---------- дрібні хелпери ---------- */
  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- рендер ---------- */
  function render(d) {
    isLight = (d.theme === "light");
    paintBody();

    var b = d.brand || {};
    document.getElementById("bName").innerHTML = esc(b.name || "EXTROVERT");
    document.getElementById("bSuf").innerHTML = esc(b.suffix || ".CAFE");
    document.getElementById("tagline").innerHTML = esc(b.tagline || "");

    var g = document.getElementById("grid");
    g.innerHTML = "";
    var list = d.drinks || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var c = el("div", "card");
      c.appendChild(el("div", "badge", esc(it.price)));
      var cup = el("div", "cup");
      cup.appendChild(el("div", "body"));
      var liq = el("div", "liq"); liq.style.background = it.color || "#7e522e";
      /* Блиск живе всередині .liq, бо там overflow:hidden — інакше він
         поїхав би по всій картці. Малюється лише на рівні 4. */
      if (ANIM >= 4) liq.appendChild(el("div", "shine"));
      cup.appendChild(liq);
      if (it.foam) cup.appendChild(el("div", "foam"));
      cup.appendChild(el("div", "rim"));
      /* Пара — три струмки. Не створюємо їх зовсім на нижчих рівнях:
         сенс заміру в тому, щоб дешевший рівень був реально дешевшим,
         а не просто з display:none на тих самих вузлах. */
      if (ANIM >= 3) {
        cup.appendChild(el("div", "steam"));
        cup.appendChild(el("div", "steam s2"));
        cup.appendChild(el("div", "steam s3"));
      }
      c.appendChild(cup);
      c.appendChild(el("div", "name", esc(it.name)));
      c.appendChild(el("div", "vol", esc(it.vol || "")));
      g.appendChild(c);
    }

    var st = document.getElementById("steps"); st.innerHTML = "";
    var steps = d.steps || [];
    for (i = 0; i < steps.length; i++) {
      var s = el("div", "step");
      s.appendChild(el("i", null, String(i + 1)));
      s.appendChild(el("b", null, esc(steps[i])));
      st.appendChild(s);
    }

    var p = document.getElementById("pays"); p.innerHTML = "";
    var pays = d.payments || [];
    for (i = 0; i < pays.length; i++) p.appendChild(el("div", "pay", esc(pays[i])));

    document.getElementById("cash").innerHTML = esc(d.cashNote || "");

    var q = d.qr || {};
    document.getElementById("qrtext").innerHTML =
      esc(q.line1 || "") + "<br><span class='hi'>" + esc(q.line2 || "") +
      "</span><br><span class='mut'>" + esc(q.line3 || "") + "</span>";

    if (d.refreshSec) refreshSec = d.refreshSec;
    if (d.reloadSec) reloadSec = d.reloadSec;
    fit();
  }

  /* ---------- цикл ---------- */
  function apply(d, fromCache) {
    var h = JSON.stringify(d);
    if (h !== lastHash) { lastHash = h; render(d); }
    if (!fromCache) {
      try { localStorage.setItem(LS, h); } catch (e) {}
      stale(false);
    }
  }

  function tick() {
    getJSON(API, function (d) { apply(d, false); },
                 function () { stale(true); });
  }

  // 1. одразу показуємо останнє збережене, щоб екран не був порожній
  try {
    var cached = localStorage.getItem(LS);
    if (cached) { apply(JSON.parse(cached), true); stale(true); }
  } catch (e) {}

  /* ---------- лічильник кадрів ----------
     Міряє головний потік. На Pi 1 цього досить, щоб побачити просідання,
     але справжнє навантаження показує top на самій малині — див. pi/README.md. */
  function startHud() {
    var hud = document.getElementById("hud");
    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
              function (f) { return setTimeout(f, 16); };
    var now = (window.performance && window.performance.now)
      ? function () { return window.performance.now(); }
      : function () { return +new Date(); };

    var frames = 0, worst = 0, minFps = 0;
    var t0 = now(), last = t0, started = t0;

    function loop() {
      var t = now(), dt = t - last; last = t;
      if (dt > worst) worst = dt;
      frames++;
      if (t - t0 >= 1000) {
        var fps = Math.round(frames * 1000 / (t - t0));
        var age = t - started;
        if (age > 3000 && (minFps === 0 || fps < minFps)) minFps = fps;
        hud.innerHTML =
          "fps <b" + (fps < 24 ? " class='bad'" : "") + ">" + fps + "</b>" +
          " · мін <b>" + (minFps || "—") + "</b><br>" +
          "найгірший кадр <b" + (worst > 100 ? " class='bad'" : "") + ">" +
            Math.round(worst) + "</b> мс<br>" +
          "anim <b>" + ANIM + "</b> · шари <b>" + (GPU ? "так" : "ні") + "</b><br>" +
          "карток <b>" + document.getElementById("grid").children.length + "</b>" +
          " · " + Math.round(age / 1000) + " с";
        frames = 0; t0 = t; worst = 0;
      }
      raf(loop);
    }
    raf(loop);
  }

  window.onresize = fit;
  paintBody();
  fit();
  if (HUD) startHud();
  tick();
  setInterval(tick, refreshSec * 1000);
  setTimeout(function () { location.reload(true); }, reloadSec * 1000);
})();
