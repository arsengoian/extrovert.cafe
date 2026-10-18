// Оболонка адмінки: ліве меню, шапка екрана й маршрут у хеші адреси
// (design/admin «Admin Screens», docs/admin_panel.md).
//
// Роутера тут немає навмисно, як і в застосунку гравця: два десятки екранів
// без вкладених маршрутів — це `location.hash` і `switch`, а не кілобайти
// бібліотеки. Адреса при цьому справжня: екран можна переслати посиланням,
// і «назад» працює.
//
// Меню перебудоване 18.10.2026 (власник: «ліве меню організоване не дуже
// логічно»): чотири групи, у кожного показника одне місце, а пункти, що
// раніше дублювали один одного, стали вкладками одного розділу. Старі адреси
// ведуть на нові місця (ALIASES).
import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { breadcrumb, setErrorScope, setErrorUser } from "./errors.js";
import { Login } from "./screens/Login.jsx";
import { Health } from "./screens/Health.jsx";
import { Pos } from "./screens/Pos.jsx";
import { Finance } from "./screens/Finance.jsx";
import { Sales } from "./screens/Sales.jsx";
import { Economy } from "./screens/Economy.jsx";
import { Analytics } from "./screens/Analytics.jsx";
import { Broadcasts } from "./screens/Broadcasts.jsx";
import { Quizzes } from "./screens/Quizzes.jsx";
import { Prices } from "./screens/Prices.jsx";
import { Promos } from "./screens/Promos.jsx";
import { Deployments } from "./screens/Deployments.jsx";
import { Problems } from "./screens/Problems.jsx";
import { Support } from "./Support.jsx";
import { QuizResponses } from "./screens/QuizResponses.jsx";
import { Orders } from "./screens/Orders.jsx";
import { Order } from "./screens/Order.jsx";
import { Users } from "./screens/Users.jsx";
import { User } from "./screens/User.jsx";
import { Purchases } from "./screens/Purchases.jsx";
import { Stock } from "./screens/Stock.jsx";
import { StockCounts } from "./screens/StockCounts.jsx";
import { StockPurchases } from "./screens/StockPurchases.jsx";
import { StockCatalog } from "./screens/StockCatalog.jsx";
import { Video } from "./screens/Video.jsx";

const I = {
  health: "M3 12h3l2-5 3 10 2-6 2 3h4",
  stats: "M4 19V9m5 10V5m5 14v-7m5 7V8",
  quiz: "M8 9h8M8 13h5M4 5h16v11H9l-5 4V5z",
  price: "M4 7h16M4 12h16M4 17h10",
  deploy: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16",
  promo: "M4 10v4h3l5 4V6l-5 4H4zm12 .5a3.5 3.5 0 0 1 0 3",
  problem: "m12 4 9 16H3L12 4zm0 6v4m0 3h.01",
  support: "M4 5h16v10H9l-5 4V5z",
  answers: "M5 6h14M5 12h14M5 18h9",
  orders: "M4 7h16l-1.5 12h-13L4 7zm4 0a4 4 0 1 1 8 0",
  users: "M4 20a6 6 0 0 1 12 0M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  cart: "M3 5h2l2 10h11M9 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2m8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  video: "M3 7h12v10H3zM15 11l6-3v8l-6-3",
  events: "m13 3-8 10h6l-2 8 8-10h-6l2-8z",
  pie: "M12 3v9h9a9 9 0 1 1-9-9z",
  analytics: "M4 18l5-6 4 3 7-9M15 6h5v5",
  broadcast: "M4 10v4h3l5 4V6l-5 4H4zm12-2a6 6 0 0 1 0 8m-2-6a3 3 0 0 1 0 4",
  finance: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H3V7zm0 0 13-3v3m1 6.5h.01",
  players: "M6 11h4M8 9v4m7-1h.01M18 10h.01M7 6h10a5 5 0 0 1 0 10h-1l-2-2h-4l-2 2H7A5 5 0 0 1 7 6z",
  stock: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0 9 4 9-4M12 11v10",
};

// Меню: [маршрут, назва, іконка, лічильник, вкладки]. Вкладки — свої
// маршрути, тож вкладку можна переслати посиланням; пункт меню світиться на
// будь-якій зі своїх вкладок.
const MENU = [
  ["огляд", [
    ["health", "Здоров'я", I.health],
    ["finance", "Фінанси", I.finance],
    ["sales", "Продажі", I.stats],
    ["players/economy", "Гравці", I.players, null, [["players/economy", "економіка гри"], ["players/app", "застосунок"]]],
  ]],
  ["кавʼярня", [
    ["receipts", "Покупки", I.cart, null, [["receipts", "чеки"], ["receipts/attempts", "невдалі спроби"]]],
    ["stock", "Залишки", I.stock, null, [["stock", "залишки"], ["stock/counts", "інвентаризації"], ["stock/purchases", "закупки"], ["stock/catalog", "матеріали й рецепти"]]],
    ["prices", "Меню", I.price, null, [["prices", "ціни"], ["promos", "акції"], ["deployments", "деплойменти"]]],
    ["orders", "Замовлення", I.orders, "orders_open"],
  ]],
  ["люди", [
    ["users", "Користувачі", I.users],
    ["support", "Підтримка", I.support, "support_waiting"],
    ["problems", "Проблеми", I.problem, "problems_open"],
    ["quizzes", "Опитування", I.quiz, "quiz_week", [["quizzes", "підсумки"], ["quiz-responses", "відповіді"]]],
    ["broadcasts", "Розсилки", I.broadcast],
  ]],
  ["відео", [
    ["video", "Записи", I.video],
    ["video/events", "Події", I.events],
  ]],
];
const ITEMS = MENU.flatMap(([, items]) => items);
const owns = (item, name) => item[0] === name || Boolean(item[4]?.some(([route]) => route === name));

// Екрани з двома частинами в імені; решта — «екран/аргумент» (users/42).
const SCREENS = new Set(["video/events", "players/economy", "players/app", "receipts/attempts", "stock/counts", "stock/purchases", "stock/catalog"]);
// Адреси до 18.10.2026 — на нові місця: закладки й посилання в старих
// повідомленнях мають відкривати те саме, а не дашборд здоровʼя.
const ALIASES = {
  stats: "finance", analytics: "players/app", players: "players/economy",
  "video/analytics": "sales", "video/purchases": "receipts",
};

const route = () => {
  const raw = window.location.hash.replace(/^#\/?/, "") || "health";
  const parts = raw.split("/");
  const two = parts.slice(0, 2).join("/");
  const pair = SCREENS.has(two) || Boolean(ALIASES[two]);
  const name = pair ? two : parts[0];
  const arg = parts.slice(pair ? 2 : 1).join("/") || null;
  return { name: ALIASES[name] ?? name, arg, alias: Boolean(ALIASES[name]) };
};

export const go = (path) => { window.location.hash = `#/${path}`; };

// Хто ми, якщо сесія не відповіла, а токен є: беремо з самого токена —
// підпис уже перевірив api, коли віддав дані.
function whoFromToken(token) {
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { id: String(claims.sub).replace("admin:", ""), email: claims.email ?? "адмін", role: claims.role ?? "owner" };
  } catch {
    return { id: "?", email: "адмін", role: "owner" };
  }
}

function Screen({ name, arg, counts }) {
  switch (name) {
    case "health": return <Health />;
    case "pos": return <Pos id={arg} />;
    case "finance": return <Finance />;
    case "sales": return <Sales />;
    case "players/economy": return <Economy />;
    case "players/app": return <Analytics />;
    case "broadcasts": return <Broadcasts />;
    case "quizzes": return <Quizzes />;
    case "prices": return <Prices />;
    case "promos": return <Promos />;
    case "deployments": return <Deployments />;
    case "problems": return <Problems />;
    case "support": return <Support id={arg} />;
    case "quiz-responses": return <QuizResponses />;
    case "orders": return arg ? <Order id={arg} /> : <Orders />;
    case "users": return arg ? <User id={arg} /> : <Users />;
    case "receipts": return <Purchases tab="receipts" />;
    case "receipts/attempts": return <Purchases tab="attempts" />;
    case "stock": return <Stock />;
    case "stock/counts": return <StockCounts arg={arg} />;
    case "stock/purchases": return <StockPurchases arg={arg} />;
    case "stock/catalog": return <StockCatalog />;
    case "video": case "video/events": return <Video tab={name.split("/")[1] ?? "segments"} />;
    default: return <Health />;
  }
}

export function App() {
  const [admin, setAdmin] = useState(null);
  const [booting, setBooting] = useState(true);
  const [counts, setCounts] = useState({});
  const [at, setAt] = useState(route);
  // Меню на телефоні — шухляда (theme.css, .menu-open); на десктопі стан
  // нічого не змінює.
  const [menu, setMenu] = useState(false);
  // Для GlitchTip: хто й на якому екрані був, коли щось упало (errors.js).
  useEffect(() => { setErrorUser(admin?.id); }, [admin?.id]);
  useEffect(() => { setErrorScope({ screen: at.name }); breadcrumb("navigation", at.name); }, [at.name]);

  // Стара адреса — замінюємо в рядку на нову, не плодячи запису в історії.
  useEffect(() => {
    if (at.alias) window.history.replaceState(null, "", `#/${at.name}${at.arg ? `/${at.arg}` : ""}`);
  }, [at]);

  useEffect(() => {
    const onHash = () => { setAt(route()); setMenu(false); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    // Кука жива — заходимо без екрана входу. Якщо куки немає, але в руках
    // ще чинний токен (його міг видати інший шлях входу), пробуємо ним:
    // викидати на екран входу з робочим токеном — зайве.
    api.restore()
      .then(setAdmin)
      .catch(async () => {
        if (!getToken()) return;
        try {
          await api.overview();
          setAdmin(whoFromToken(getToken()));
        } catch {
          setToken(null);
        }
      })
      .finally(() => setBooting(false));
  }, []);

  const loadCounts = useCallback(() => {
    api.overview()
      .then((o) => setCounts(Object.fromEntries((o.counts ?? []).map((c) => [c.key, c.value]))))
      .catch(() => {});
  }, []);
  useEffect(() => { if (admin) loadCounts(); }, [admin, at.name, loadCounts]);

  if (booting) return <div className="login" />;
  if (!admin) return <Login onIn={setAdmin} />;

  const initials = (admin.email ?? "?").slice(0, 2).toUpperCase();
  const item = ITEMS.find((i) => owns(i, at.name));
  const current = item?.[1] ?? (at.name === "pos" ? "Точка" : "extrovert.cafe");

  return (
    <div className={`shell${menu ? " menu-open" : ""}`}>
      <header className="topbar">
        <button className="menu-btn" onClick={() => setMenu(true)} aria-label="меню" aria-expanded={menu}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span className="brand-mark" />
        <b>{current}</b>
      </header>
      <div className="side-back" onClick={() => setMenu(false)} />
      <aside className="side">
        <div className="brand">
          <span className="brand-mark" />
          <span><b>extrovert.cafe</b><small>АДМІНКА</small></span>
        </div>

        {MENU.map(([group, items]) => (
          <nav className="side-group" key={group}>
            <div className="side-title">{group.toUpperCase()}</div>
            {items.map((entry) => {
              const [name, title, icon, countKey] = entry;
              return (
              <button
                key={name}
                className="side-item"
                aria-current={owns(entry, at.name) ? "page" : undefined}
                onClick={() => { setMenu(false); go(name); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                {title}
                {countKey && counts[countKey] > 0 && <span className="count">{counts[countKey]}</span>}
              </button>
              );
            })}
          </nav>
        ))}

        <div className="side-foot">
          <span className="who">{initials}</span>
          <span>
            <b>{admin.email}</b>
            <button onClick={() => api.logout().finally(() => setAdmin(null))}>вийти</button>
          </span>
        </div>
      </aside>

      <main>
        {/* Вкладки розділу — над екраном, кожна своїм маршрутом. На детальній
            сторінці (замовлення, гравець) їх немає: там своя навігація. */}
        {item?.[4] && !at.arg && (
          <nav className="subnav chips">
            {item[4].map(([routeName, label]) => (
              <button key={routeName} className={`pill${at.name === routeName ? " on" : ""}`} onClick={() => go(routeName)}>{label}</button>
            ))}
          </nav>
        )}
        <Screen name={at.name} arg={at.arg} counts={counts} />
      </main>
    </div>
  );
}
