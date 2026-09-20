// Оболонка застосунку: HUD або back-топбар, сцена й нижня навігація —
// рівно як у дизайні (design/client/Phone.dc.html).
//
// Навігація своя, без роутера: у застосунку п'ять вкладок і стек екранів
// поверх них. Бібліотека тут коштувала б кілобайти на телефоні заради
// одного pushState. Екрани бувають двох видів: повні (зі своїм топбаром) і
// шторки (поверх поточної вкладки) — як у макетах.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { Hud } from "./ui/Hud.jsx";
import { Nav } from "./ui/Nav.jsx";
import { TopbarBack } from "./ui/TopbarBack.jsx";
import { connectEvents } from "./ws.js";
import { SCREENS, TAB_SCREEN } from "./screens/index.js";
import { Start } from "./screens/Start.jsx";
import "./theme.js";

export function App({ bonusToken = null }) {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState("plant");
  const [stack, setStack] = useState([]);           // екрани поверх вкладки

  const refreshMe = useCallback(async () => {
    const data = await api.get("/me");
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    // Токен у памʼяті може бути протухлим, зате кука жива — тоді застосунок
    // має відкритись без екрана входу.
    const boot = getToken()
      ? refreshMe().catch(() => api.restore().then(refreshMe))
      : api.restore().then(refreshMe);
    boot.catch(() => setToken(null)).finally(() => setBooting(false));
  }, [refreshMe]);

  const push = useCallback((name, props = {}) => setStack((s) => [...s, { name, props }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const openTab = useCallback((next) => { setTab(next); setStack([]); }, []);

  // Бонус із QR: відкриваємо його, щойно гравець увійшов, і прибираємо
  // токен з адреси — щоб оновлення сторінки не намагалось забрати його ще раз.
  useEffect(() => {
    if (!bonusToken || !me) return;
    push("bonus", { token: bonusToken });
    window.history.replaceState({}, "", "/");
  }, [bonusToken, Boolean(me)]);

  // Події з ws: після будь-якої зміни в акаунті перечитуємо профіль —
  // баланси в HUD мають оновлюватись без перезаходу.
  useEffect(() => {
    if (!me) return undefined;
    return connectEvents((msg) => {
      if (msg.event && msg.event !== "hello") refreshMe().catch(() => {});
    });
  }, [me?.id, refreshMe]);

  // Апаратна «назад» на телефоні має закривати екран, а не виходити із
  // застосунку: кладемо запис в історію на кожен push.
  useEffect(() => {
    const onPop = () => setStack((s) => (s.length ? s.slice(0, -1) : s));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (stack.length) window.history.pushState({ depth: stack.length }, "");
  }, [stack.length]);

  const ctx = useMemo(
    () => ({ me, refreshMe, push, pop, openTab, tab }),
    [me, refreshMe, push, pop, openTab, tab]
  );

  if (booting) return <div className="app" />;

  if (!me) {
    return (
      <div className="app">
        <Start onSignedIn={async () => { await refreshMe(); setBooting(false); }} />
      </div>
    );
  }

  // Верхній екран стеку. Шторки не ховають вкладку під собою — вони
  // лягають поверх неї, тож малюємо і те, і те.
  const top = stack[stack.length - 1] ?? null;
  const topScreen = top ? SCREENS[top.name] : null;
  const asSheet = topScreen?.presentation === "sheet";

  const baseName = TAB_SCREEN[tab];
  const base = SCREENS[baseName];
  const shown = !top || asSheet ? base : topScreen;
  const Shown = shown?.component ?? (() => <div className="stage-pad">Екран у роботі</div>);
  const Sheet = asSheet ? topScreen.component : null;
  const title = typeof topScreen?.title === "function" ? topScreen.title(top?.props ?? {}) : topScreen?.title;

  return (
    <div className="app">
      {top && !asSheet ? <TopbarBack title={title} onBack={pop} /> : <Hud me={me} onOpen={push} />}
      <div className="stage" key={top && !asSheet ? `${top.name}:${stack.length}` : tab}>
        {/* props із реєстру — значення за замовчуванням: ними один компонент
            обслуговує кілька екранів (умови, приватність, підтримка). */}
        <Shown {...(shown?.props ?? {})} {...(asSheet || !top ? {} : top.props)} ctx={ctx} />
      </div>
      {Sheet ? <Sheet {...(top.props ?? {})} ctx={ctx} /> : null}
      {(top && !asSheet ? topScreen?.hideNav : false) ? null : (
        <Nav tab={tab} onTab={openTab} badges={me.badges} />
      )}
    </div>
  );
}
