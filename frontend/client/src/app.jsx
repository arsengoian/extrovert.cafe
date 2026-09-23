// Оболонка застосунку: HUD або back-топбар, сцена й нижня навігація —
// рівно як у дизайні (design/client/Phone.dc.html).
//
// Навігація своя, без роутера: у застосунку п'ять вкладок і стек екранів
// поверх них. Бібліотека тут коштувала б кілобайти на телефоні заради
// одного pushState. Екрани бувають двох видів: повні (зі своїм топбаром) і
// шторки (поверх поточної вкладки) — як у макетах.
import { useCallback, useEffect, useMemo, useState } from "react";
import { openSupport } from "./ui/support.jsx";
import { api, getToken } from "./api.js";
import { Hud } from "./ui/Hud.jsx";
import { Nav } from "./ui/Nav.jsx";
import { TopbarBack } from "./ui/TopbarBack.jsx";
import { connectEvents } from "./ws.js";
import { SCREENS, TAB_SCREEN } from "./screens/index.js";
import { Start } from "./screens/Start.jsx";
import { Onboarding } from "./screens/Onboarding.jsx";
import { BonusPopup } from "./screens/Bonus.jsx";
import "./theme.js";

const TAB_KEY = "extrovert.tab";

export function App({ bonusToken = null, returningFromPayment = false, login = null, legalDoc = null }) {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  // Вкладка переживає перезавантаження: людина оновлює сторінку на «Складі»
  // й має лишитись на «Складі», а не поїхати на кавенятко. Стек екранів
  // поверх вкладки навмисно не відновлюємо — у нього кладуть props із
  // живими об'єктами (лот, предмет, кавенятко), і «відновлений» екран
  // показував би застарілі дані замість свіжих.
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem(TAB_KEY) || "plant"; } catch { return "plant"; }
  });
  const [stack, setStack] = useState([]);           // екрани поверх вкладки
  // Екран, відкритий до входу: скарга, умови, підтримка. У макеті вони в
  // розділі «Поза авторизацією» — ними користуються ще без акаунта.
  // Адреса документа (/privacy-policy) відкриває його одразу — спершу
  // екраном «поза авторизацією»; якщо акаунт є, нижче він переїде в стек.
  const [guest, setGuest] = useState(() => (legalDoc ? { name: legalDoc } : null));
  // Бонус із QR кіоска, який чекає на вхід: сума й перша річ для стартового
  // екрана. Без нього — варіант «без бонусів».
  const [pendingBonus, setPendingBonus] = useState(null);
  // Попап над вкладкою: «Переказ виконано», «Монети зараховано» у макеті
  // висять над гаманцем, а не над екраном, з якого прийшли.
  const [notice, setNotice] = useState(null);
  // Що сказати на стартовому екрані: посилання з листа не спрацювало чи
  // api не відповідає.
  const [bootNote, setBootNote] = useState(null);

  useEffect(() => {
    if (me || !bonusToken) return;
    api.get(`/bonus/${encodeURIComponent(bonusToken)}/preview`)
      .then((b) => {
        if (!b.available) return;
        setPendingBonus({ coins: b.coins, item: b.items?.[0] ?? null });
      })
      .catch(() => {});
  }, [me, bonusToken]);

  // rev зростає на кожному оновленні «мене». Екрани, що тримають власні
  // дані (покупки, склад, лоти), інакше лишаються зі знімком на момент
  // відкриття: забрав бонус — баланс у шапці змінився, а «Покупки» ще
  // порожні, бо їх ніхто не перепитував.
  const [rev, setRev] = useState(0);
  const refreshMe = useCallback(async () => {
    const data = await api.get("/me");
    setMe(data);
    setRev((n) => n + 1);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      // Прийшли з листа: сесія вже є (main.jsx). Якщо вхід починався з бонусу
      // кіоска, вертаємось на його адресу — там застосунок сам покаже бонус.
      if (login) {
        try {
          const r = await login;
          if (r.next && r.next !== "/") { window.location.replace(r.next); return false; }
        } catch (e) {
          setBootNote(e.status
            ? "Посилання застаріло або вже використане – надішли нове"
            : "Не вдалось увійти: немає зв'язку. Відкрий посилання з листа ще раз");
        }
      }
      // Токен у памʼяті може бути протухлим, зате кука жива — тоді застосунок
      // відкривається без екрана входу. 401 — сесії справді немає. Решта —
      // мережа чи api посеред деплою: пробуємо ще, а не вилогінюємо.
      for (let attempt = 0; ; attempt++) {
        try {
          if (!getToken()) await api.restore();
          await refreshMe();
          return true;
        } catch (e) {
          if (e.status === 401) return true;
          if (attempt >= 2) {
            setBootNote("Немає зв'язку з сервером – спробуй трохи згодом");
            return true;
          }
          await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
          if (!alive) return false;
        }
      }
    };
    boot().then((done) => { if (done && alive) setBooting(false); });
    return () => { alive = false; };
  }, [refreshMe, login]);

  const push = useCallback((name, props = {}) => setStack((s) => [...s, { name, props }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  // Заміна верхнього екрана без кроку назад: вкладки «Умови / Приватність»
  // міняють і текст, і заголовок топбару, як два окремі кадри макета.
  const replace = useCallback((name, props = {}) => setStack((s) => [...s.slice(0, -1), { name, props }]), []);
  const openTab = useCallback((next) => {
    setTab(next);
    setStack([]);
    try { sessionStorage.setItem(TAB_KEY, next); } catch { /* приватний режим — просто не памʼятаємо */ }
  }, []);

  // Бонус із QR: щойно гравець увійшов — попап над «Покупками», як у кадрі
  // «Попап редіму бонусу». Токен прибираємо з адреси, щоб оновлення
  // сторінки не намагалось забрати його ще раз.
  useEffect(() => {
    if (!bonusToken || !me?.consent) return;
    openTab("history");
    setNotice(<BonusPopup token={bonusToken} ctx={{ me, refreshMe }} onClose={() => setNotice(null)} />);
    window.history.replaceState({}, "", "/");
  }, [bonusToken, Boolean(me?.consent)]);

  // Повернення з банку: показуємо статус оплати й прибираємо ?pay з адреси,
  // щоб перезавантаження сторінки не відкривало той самий екран знову.
  useEffect(() => {
    if (!returningFromPayment || !me) return;
    push("paymentResult", {});
    window.history.replaceState({}, "", "/");
  }, [returningFromPayment, Boolean(me)]);

  // Події з ws: після будь-якої зміни в акаунті перечитуємо профіль —
  // баланси в HUD мають оновлюватись без перезаходу.
  useEffect(() => {
    if (!me) return undefined;
    return connectEvents((msg) => {
      if (msg.event && msg.event !== "hello") refreshMe().catch(() => {});
    });
  }, [me?.id, refreshMe]);

  // Документ за адресою, а людина з акаунтом: показуємо його поверх вкладки.
  useEffect(() => {
    if (me && legalDoc && guest?.name === legalDoc) {
      setStack([{ name: legalDoc, props: {} }]);
      setGuest(null);
    }
  }, [Boolean(me)]);

  // Документ закрили — адреса стає звичайною: інакше оновлення сторінки
  // відкривало б його знову.
  useEffect(() => {
    if (!legalDoc || window.location.pathname === "/") return;
    if (guest?.name !== legalDoc && !stack.some((s) => s.name === legalDoc)) window.history.replaceState({}, "", "/");
  }, [legalDoc, guest, stack]);

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

  // «Підтримка» звідусіль веде в Telegram-бот, а не на екран застосунку.
  const support = useCallback(() => openSupport(setNotice), []);
  const ctx = useMemo(
    () => ({ me, rev, refreshMe, push, pop, replace, openTab, tab, notify: setNotice, support }),
    [me, rev, refreshMe, push, pop, replace, openTab, tab, support]
  );

  if (booting) return <div className="app" />;

  if (!me) {
    if (guest) {
      const def = SCREENS[guest.name];
      const Guest = def.component;
      const guestTitle = typeof def.title === "function" ? def.title(guest.props ?? {}) : def.title;
      const guestCtx = {
        me: null, refreshMe, tab: null, openTab: () => setGuest(null), notify: setNotice, support,
        pop: () => setGuest(null), push: (name, props = {}) => setGuest({ name, props }),
        replace: (name, props = {}) => setGuest({ name, props }),
      };
      return (
        <div className="app">
          <TopbarBack title={guestTitle} onBack={() => setGuest(null)} />
          <div className="stage" key={guest.name}>
            <Guest {...(def.props ?? {})} {...(guest.props ?? {})} ctx={guestCtx} />
          </div>
          {notice}
        </div>
      );
    }
    return (
      <div className="app">
        <Start
          bonus={pendingBonus}
          note={bootNote}
          onSignedIn={async () => { await refreshMe(); setBooting(false); }}
          onEmail={() => { setBootNote(null); setGuest({ name: "emailLogin", props: { next: bonusToken ? `/b/${bonusToken}` : "/" } }); }}
          onProblem={() => setGuest({ name: "problem" })}
          onSupport={support}
        />
        {notice}
      </div>
    );
  }

  // Перший вхід: без згоди з умовами далі екрана нікнейма не пускаємо.
  // «Назад» — передумав входити: виходимо на стартовий екран.
  if (!me.consent) {
    return (
      <div className="app">
        <Onboarding me={me} onDone={refreshMe} onCancel={() => api.logout().finally(() => setMe(null))} />
      </div>
    );
  }

  // Верхній екран стеку. Шторки не ховають вкладку під собою — вони
  // лягають поверх неї, тож малюємо і те, і те.
  const top = stack[stack.length - 1] ?? null;
  const topScreen = top ? SCREENS[top.name] : null;
  const asSheet = topScreen?.presentation === "sheet";
  // HUD і нижнє меню над екраном стеку — для карток поверх неба вкладки.
  const keepChrome = typeof topScreen?.keepChrome === "function" ? topScreen.keepChrome(top?.props ?? {}) : Boolean(topScreen?.keepChrome);

  const baseName = TAB_SCREEN[tab];
  const base = SCREENS[baseName];
  const shown = !top || asSheet ? base : topScreen;
  const Shown = shown?.component ?? (() => <div className="stage-pad">Екран у роботі</div>);
  const Sheet = asSheet ? topScreen.component : null;
  const title = typeof topScreen?.title === "function" ? topScreen.title(top?.props ?? {}) : topScreen?.title;

  return (
    <div className="app">
      {top && !asSheet && !keepChrome ? <TopbarBack title={title} onBack={pop} /> : <Hud me={me} onOpen={push} onSupport={support} />}
      <div className="stage" key={top && !asSheet ? `${top.name}:${stack.length}` : tab}>
        {/* props із реєстру — значення за замовчуванням: ними один компонент
            обслуговує кілька екранів (умови, приватність, підтримка). */}
        <Shown {...(shown?.props ?? {})} {...(asSheet || !top ? {} : top.props)} ctx={ctx} />
      </div>
      {Sheet ? <Sheet {...(top.props ?? {})} ctx={ctx} /> : null}
      {(top && !asSheet && !keepChrome ? topScreen?.hideNav : false) ? null : (
        <Nav tab={tab} onTab={openTab} badges={me.badges} />
      )}
      {notice}
    </div>
  );
}
