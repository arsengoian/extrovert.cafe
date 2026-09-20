// Оболонка застосунку: HUD або back-топбар, сцена й нижня навігація —
// рівно як у дизайні (design/client/Phone.dc.html).
//
// Навігація своя, без роутера: у застосунку п'ять вкладок і стек екранів
// поверх них. Бібліотека тут коштувала б кілобайти на телефоні заради
// одного pushState.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { Hud } from "./ui/Hud.jsx";
import { Nav } from "./ui/Nav.jsx";
import { TopbarBack } from "./ui/TopbarBack.jsx";
import { SCREENS, TAB_SCREEN } from "./screens/index.js";
import { Start } from "./screens/Start.jsx";

export function App() {
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
    if (!getToken()) { setBooting(false); return; }
    refreshMe().catch(() => setToken(null)).finally(() => setBooting(false));
  }, [refreshMe]);

  const push = useCallback((name, props = {}) => setStack((s) => [...s, { name, props }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const openTab = useCallback((next) => { setTab(next); setStack([]); }, []);

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

  const top = stack[stack.length - 1] ?? null;
  const current = top ? SCREENS[top.name] : SCREENS[TAB_SCREEN[tab]];
  const Screen = current?.component ?? (() => <div className="stage-pad">Екран у роботі</div>);
  const title = typeof current?.title === "function" ? current.title(top?.props ?? {}) : current?.title;

  return (
    <div className="app">
      {top ? <TopbarBack title={title} onBack={pop} /> : <Hud me={me} onOpen={push} />}
      <div className="stage" key={top ? `${top.name}:${stack.length}` : tab}>
        <Screen {...(top?.props ?? {})} ctx={ctx} />
      </div>
      {current?.hideNav ? null : (
        <Nav tab={tab} onTab={openTab} badges={me.badges} />
      )}
    </div>
  );
}
