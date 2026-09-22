// Оболонка адмінки: ліве меню, шапка екрана й маршрут у хеші адреси
// (design/admin «Admin Screens», docs/admin_panel.md).
//
// Роутера тут немає навмисно, як і в застосунку гравця: сімнадцять екранів
// і жодного вкладеного маршруту — це `location.hash` і `switch`, а не
// кілобайти бібліотеки. Адреса при цьому справжня: екран можна переслати
// посиланням, і «назад» працює.
import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { Login } from "./screens/Login.jsx";
import { Health } from "./screens/Health.jsx";
import { Pos } from "./screens/Pos.jsx";
import { Stats } from "./screens/Stats.jsx";
import { Quizzes } from "./screens/Quizzes.jsx";
import { Prices } from "./screens/Prices.jsx";
import { Deployments } from "./screens/Deployments.jsx";
import { Problems } from "./screens/Problems.jsx";
import { Support } from "./Support.jsx";
import { QuizResponses } from "./screens/QuizResponses.jsx";
import { Orders } from "./screens/Orders.jsx";
import { Order } from "./screens/Order.jsx";
import { Users } from "./screens/Users.jsx";
import { User } from "./screens/User.jsx";
import { Receipts } from "./screens/Receipts.jsx";
import { Video } from "./screens/Video.jsx";

const I = {
  health: "M3 12h3l2-5 3 10 2-6 2 3h4",
  stats: "M4 19V9m5 10V5m5 14v-7m5 7V8",
  quiz: "M8 9h8M8 13h5M4 5h16v11H9l-5 4V5z",
  price: "M4 7h16M4 12h16M4 17h10",
  deploy: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16",
  problem: "m12 4 9 16H3L12 4zm0 6v4m0 3h.01",
  support: "M4 5h16v10H9l-5 4V5z",
  answers: "M5 6h14M5 12h14M5 18h9",
  orders: "M4 7h16l-1.5 12h-13L4 7zm4 0a4 4 0 1 1 8 0",
  users: "M4 20a6 6 0 0 1 12 0M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  cart: "M3 5h2l2 10h11M9 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2m8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  video: "M3 7h12v10H3zM15 11l6-3v8l-6-3",
  events: "m13 3-8 10h6l-2 8 8-10h-6l2-8z",
  pie: "M12 3v9h9a9 9 0 1 1-9-9z",
};

// Меню: групи й порядок — як у макеті.
const MENU = [
  ["управління", [
    ["health", "Здоров'я", I.health],
    ["stats", "Статистика", I.stats],
    ["quizzes", "Опитування", I.quiz],
  ]],
  ["операційка", [
    ["prices", "Ціни", I.price],
    ["deployments", "Деплойменти", I.deploy],
    ["problems", "Проблеми", I.problem, "problems_open"],
    ["support", "Підтримка", I.support, "support_waiting"],
    ["quiz-responses", "Відповіді", I.answers, "quiz_week"],
    ["orders", "Замовлення", I.orders, "orders_open"],
  ]],
  ["користувачі", [
    ["users", "Користувачі", I.users],
    ["receipts", "Покупки", I.cart],
  ]],
  ["відео", [
    ["video", "Записи", I.video],
    ["video/events", "Події", I.events],
    ["video/analytics", "Аналітика", I.pie],
  ]],
];

const route = () => {
  const raw = window.location.hash.replace(/^#\/?/, "") || "health";
  const [head, ...rest] = raw.split("/");
  if (head === "video") return { name: rest[0] ? `video/${rest[0]}` : "video", arg: null };
  return { name: head, arg: rest.join("/") || null };
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
    case "stats": return <Stats />;
    case "quizzes": return <Quizzes />;
    case "prices": return <Prices />;
    case "deployments": return <Deployments />;
    case "problems": return <Problems />;
    case "support": return <Support />;
    case "quiz-responses": return <QuizResponses />;
    case "orders": return arg ? <Order id={arg} /> : <Orders />;
    case "users": return arg ? <User id={arg} /> : <Users />;
    case "receipts": return <Receipts />;
    case "video": case "video/events": case "video/analytics": return <Video tab={name.split("/")[1] ?? "segments"} />;
    default: return <Health />;
  }
}

export function App() {
  const [admin, setAdmin] = useState(null);
  const [booting, setBooting] = useState(true);
  const [counts, setCounts] = useState({});
  const [at, setAt] = useState(route());

  useEffect(() => {
    const onHash = () => { setAt(route()); window.scrollTo(0, 0); };
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

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark" />
          <span><b>extrovert.cafe</b><small>АДМІНКА</small></span>
        </div>

        {MENU.map(([group, items]) => (
          <nav className="side-group" key={group}>
            <div className="side-title">{group.toUpperCase()}</div>
            {items.map(([name, title, icon, countKey]) => (
              <button
                key={name}
                className="side-item"
                aria-current={at.name === name ? "page" : undefined}
                onClick={() => go(name)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                {title}
                {countKey && counts[countKey] > 0 && <span className="count">{counts[countKey]}</span>}
              </button>
            ))}
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
        <Screen name={at.name} arg={at.arg} counts={counts} />
      </main>
    </div>
  );
}
