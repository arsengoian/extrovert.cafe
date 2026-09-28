// Оболонка застосунку: HUD або back-топбар, сцена й нижня навігація —
// рівно як у дизайні (design/client/Phone.dc.html).
//
// Навігація своя, без роутера: у застосунку п'ять вкладок і стек екранів
// поверх них. Бібліотека тут коштувала б кілобайти на телефоні заради
// одного pushState. Екрани бувають двох видів: повні (зі своїм топбаром) і
// шторки (поверх поточної вкладки) — як у макетах.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openSupport } from "./ui/support.jsx";
import { api, getToken } from "./api.js";
import { Hud } from "./ui/Hud.jsx";
import { Nav } from "./ui/Nav.jsx";
import { TopbarBack } from "./ui/TopbarBack.jsx";
import { connectEvents } from "./ws.js";
import { NetStatus } from "./ui/Net.jsx";
import { SCREENS, TAB_SCREEN } from "./screens/index.js";
import { Start } from "./screens/Start.jsx";
import { Onboarding } from "./screens/Onboarding.jsx";
import { BonusPopup } from "./screens/Bonus.jsx";
import { LoginConfirm } from "./screens/LoginConfirm.jsx";
import { readLoginWait } from "./loginWait.js";
import { ResultPopup } from "./ui/Popup.jsx";
import { clearBonuses, dropBonus, isStashed, stashBonus, stashedBonuses } from "./bonusStash.js";
import { beans as beansText } from "./ui/plural.js";
import "./theme.js";

const TAB_KEY = "extrovert.tab";

export function App({ bonusToken = null, returningFromPayment = false, login = null, confirmLogin = null, legalDoc = null, loginNote = null }) {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  // Вкладка переживає перезавантаження: людина оновлює сторінку на «Складі»
  // й має лишитись на «Складі», а не поїхати на кавенятко. Стек екранів
  // поверх вкладки навмисно не відновлюємо — у нього кладуть props із
  // живими об'єктами (лот, предмет, кавенятко), і «відновлений» екран
  // показував би застарілі дані замість свіжих.
  // Ширина застосунку числом у CSS: із неї рахуються масштаби макетних
  // блоків, які не можна перелити у флекс (примірочна 328 px). Число, а не
  // довжина: scale() бере лише число, а поділити px на px CSS не вміє.
  useEffect(() => {
    const set = () => document.documentElement.style.setProperty(
      "--appw", String(Math.min(480, window.innerWidth)));
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

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
  // null — ще не підключались; false — сокет мовчить. Смужку малює NetStatus,
  // і не раніше, ніж мовчання стане довшим за звичайне перепідключення.
  const [wsOnline, setWsOnline] = useState(null);
  // Що сказати на стартовому екрані: посилання з листа не спрацювало чи
  // api не відповідає.
  const [bootNote, setBootNote] = useState(loginNote);
  // Посилання з листа відкрили не там, де просили вхід: спершу «Це ти
  // входиш?» (screens/LoginConfirm.jsx), застосунок — потім.
  const [confirming, setConfirming] = useState(confirmLogin);

  // Бонуси гостя накопичуються на пристрої (bonusStash.js): новий QR додає
  // свій токен до вже збережених, а стартовий екран показує всі разом —
  // суму монет і кожен предмет. Новий токен беремо, лише якщо його ще ніхто
  // не забрав; уже збережений тримаємо, доки його не зарахують.
  useEffect(() => {
    if (me) return;
    const enc = encodeURIComponent;
    const fresh = bonusToken && !isStashed(bonusToken) ? bonusToken : null;
    const tokens = [...new Set([...stashedBonuses(), ...(fresh ? [fresh] : [])])];
    if (!tokens.length) { setPendingBonus(null); return; }
    Promise.all(tokens.map((t) => api.get(`/bonus/${enc(t)}/preview`).then((b) => ({ t, b })).catch((e) => ({ t, b: null, gone: e.status === 404 }))))
      .then((list) => {
        const live = [];
        for (const { t, b, gone } of list) {
          if (gone || b?.redeemed || (t === fresh && b && !b.available)) { if (t !== fresh) dropBonus(t); continue; }
          if (!b) continue;   // мережа — лишаємо, спробуємо наступного разу
          live.push(b);
          if (t === fresh) {
            stashBonus(t);
            // Бонус у телефоні — кіоску час прибрати QR з екрана.
            api.post(`/bonus/${enc(t)}/seen`, {}).catch(() => {});
          }
        }
        setPendingBonus(live.length ? {
          coins: live.reduce((n, b) => n + (b.coins ?? 0), 0),
          items: live.flatMap((b) => b.items ?? []),
        } : null);
      });
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
          // Сесії немає — після входу стартуємо з «Кавенятка», навіть якщо в
          // цій вкладці до виходу був відкритий «Склад» чи «Гаманець»: вхід,
          // зокрема нового гравця, — це початок, а не продовження (власник,
          // 28.09.2026).
          if (e.status === 401) {
            try { sessionStorage.removeItem(TAB_KEY); } catch { /* приватний режим */ }
            setTab("plant");
            return true;
          }
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

  // Бонус із QR: щойно гравець увійшов — попап із монетами, а під ним
  // кавенятко (рішення власника 23.09.2026: перше, що бачить людина після
  // входу, — її кущ, а не список покупок). Токен прибираємо з адреси, щоб
  // оновлення сторінки не намагалось забрати його ще раз.
  // Разом із бонусами, що гість накопичив до входу (bonusStash.js): після
  // входу всі зараховуються одним попапом.
  useEffect(() => {
    if (!me?.consent) return;
    const tokens = [...new Set([bonusToken, ...stashedBonuses()].filter(Boolean))];
    if (!tokens.length) return;
    openTab("plant");
    setNotice(<BonusPopup tokens={tokens} ctx={{ me, refreshMe }}
                          onDone={clearBonuses} onClose={() => setNotice(null)} />);
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
  // баланси в HUD мають оновлюватись без перезаходу. Шле їх сама база
  // (тригери на users і plants, міграція announce_user_changes): кожна зміна
  // балансу чи власника кавенятка, з якого б маршруту вона не прийшла.
  //
  // Перечитування збираємо в одне, через 200 мс після останньої події: одна
  // транзакція може змінити баланс кількома UPDATE, а свою дію клієнт і так
  // перечитує сам — без цього кожен полив коштував би два-три однакові /me.
  const eventRefresh = useRef(null);
  useEffect(() => {
    if (!me) return undefined;
    const stop = connectEvents(
      (msg) => {
        if (!msg.event || msg.event === "hello") return;
        // Знижка в кав'ярні не спрацювала — знижене меню не доїхало до
        // точки, і зерна повернулись самі (lib/discounts.js). Кажемо прямо,
        // інакше людина бачила б лише, що зерна «зникли й з'явились».
        if (msg.event === "discount_refunded") {
          const close = () => setNotice(null);
          setNotice(
            <ResultPopup art={<img src="/assets/ui/pos_discount.png" alt="" style={{ width: 58, height: 58, objectFit: "contain" }} />}
                         title="Знижка не спрацювала" onClose={close}>
              <div className="result-note">
                {`Знижені ціни не доїхали до автомата${msg.point_name ? ` у кав'ярні ${msg.point_name}` : ""}, тож зерна повернуто: +${beansText(msg.beans ?? 0)}.`}
              </div>
            </ResultPopup>
          );
        }
        clearTimeout(eventRefresh.current);
        eventRefresh.current = setTimeout(() => refreshMe().catch(() => {}), 200);
      },
      setWsOnline
    );
    return () => { clearTimeout(eventRefresh.current); stop(); };
  }, [me?.id, refreshMe]);

  // Документ за адресою, а людина з акаунтом і згодою: показуємо його поверх
  // вкладки. Без згоди лишаємо гостьовим екраном — нижче він малюється
  // раніше за онбординг.
  useEffect(() => {
    if (me?.consent && legalDoc && guest?.name === legalDoc) {
      setStack([{ name: legalDoc, props: {} }]);
      setGuest(null);
    }
  }, [Boolean(me?.consent)]);

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
  // depth — скільки екранів лежить поверх вкладки: так екран знає, що
  // його накрили шторкою (Профіль), хоч він і лишився змонтованим.
  const ctx = useMemo(
    () => ({ me, rev, refreshMe, push, pop, replace, openTab, tab, notify: setNotice, support, depth: stack.length }),
    [me, rev, refreshMe, push, pop, replace, openTab, tab, support, stack.length]
  );

  // Цей браузер просив лист і сторінку перезавантажили — повертаємось на
  // «Лист уже летить» і чекаємо далі, а не губимо прохання (loginWait.js).
  useEffect(() => {
    const w = !booting && !me && !guest ? readLoginWait() : null;
    if (w) setGuest({ name: "emailLogin", props: { next: w.next ?? "/" } });
  }, [booting]);

  if (confirming) {
    return (
      <div className="app">
        <div className="stage">
          <LoginConfirm token={confirming} onDone={async (r) => {
            setConfirming(null);
            if (!r) return;
            if (r.next && r.next !== "/") { window.location.replace(r.next); return; }
            await refreshMe().catch(() => {});
          }} />
        </div>
        {notice}
      </div>
    );
  }

  if (booting) return <div className="app" />;

  // Гостьовий екран — поза авторизацією: скарга, підтримка, умови,
  // політика. Окремою функцією, бо показувати його доводиться з двох
  // місць: до входу й на екрані згоди.
  const guestView = () => {
    const def = SCREENS[guest.name];
    const Guest = def.component;
    const guestTitle = typeof def.title === "function" ? def.title(guest.props ?? {}) : def.title;
    const guestCtx = {
      me: null, refreshMe, tab: null, openTab: () => setGuest(null), notify: setNotice, support,
      // Вхід стався з гостьового екрана (пошту підтвердили з листа): далі
      // звичайний застосунок, без гостьового екрана поверх.
      signedIn: async () => { await refreshMe(); setGuest(null); },
      pop: () => setGuest(null), push: (name, props = {}) => setGuest({ name, props }),
      replace: (name, props = {}) => setGuest({ name, props }),
    };
    return (
      <div className="app shell">
        <TopbarBack title={guestTitle} onBack={() => setGuest(null)} />
        <div className="stage" key={guest.name}>
          <Guest {...(def.props ?? {})} {...(guest.props ?? {})} ctx={guestCtx} />
        </div>
        {notice}
      </div>
    );
  };

  // Умови й політику відкривають саме з екрана згоди — тобто тоді, коли
  // consent ще немає. Тому документ малюємо ДО перевірки згоди: інакше нова
  // вкладка з /terms показувала б знову екран входу (скарга власника
  // 23.09.2026).
  if (guest && (guest.name === "terms" || guest.name === "privacy")) return guestView();

  if (!me) {
    if (guest) return guestView();
    return (
      <div className="app">
        <Start
          bonus={pendingBonus}
          note={bootNote}
          next={bonusToken ? `/b/${bonusToken}` : "/"}
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
      <div className="app shell">
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
    <div className="app shell">
      {top && !asSheet && !keepChrome ? <TopbarBack title={title} onBack={pop} /> : <Hud me={me} onOpen={push} onWallet={() => openTab("wallet")} onSupport={support} />}
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
      <NetStatus wsOnline={wsOnline} />
    </div>
  );
}
