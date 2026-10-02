// Чат із кавенятком. Окрім розмови, це ще й стрічка сповіщень акаунта:
// продажі, нарахування, статуси замовлень приходять сюди системними
// репліками (gamification_ui §«Сповіщення» — пушів ми не робимо).
import { Fragment, useEffect, useRef, useState } from "react";
import { api, errText } from "../api.js";
import { NotEnoughCoins } from "../ui/NotEnough.jsx";

const BLOCKED = {
  mood: "Кавенятко засумувало й мовчить. Полий його – і воно знову заговорить.",
  on_sale: "Кавенятко виставлене на продаж і заморожене. Зніми його з ринку, щоб поговорити.",
};

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "сьогодні";
  const yesterday = new Date(today.getTime() - 86400000);
  if (same(d, yesterday)) return "вчора";
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
};

// Валюта в сповіщеннях приходить токеном (:gold:, lib/notify.js) і
// малюється тією самою іконкою, що в гаманці (власник, 01.10.2026).
const CURRENCY = {
  ":gold:": ["/assets/ui/coin_gold.webp", "золотих монет"],
  ":silver:": ["/assets/ui/coin_silver.webp", "срібних монет"],
  ":bean:": ["/assets/ui/bean.webp", "зерен"],
};
// [order:12] — посилання на картку замовлення (lib/orders.js): кнопка
// відкриває «Мої замовлення → картку», а не голий номер, який довелося б
// шукати в списку (gamification_ui.md, «Сповіщення»).
const ORDER = /^\[order:(\d+)\]$/;
const withTokens = (text, ctx) => String(text ?? "").split(/(:gold:|:silver:|:bean:|\[order:\d+\])/).map((part, i) => {
  if (CURRENCY[part]) return <img key={i} className="chat-cur" src={CURRENCY[part][0]} alt={CURRENCY[part][1]} />;
  const order = part.match(ORDER);
  if (order) return <button key={i} className="chat-link" onClick={() => ctx.push("order", { id: Number(order[1]) })}>Відкрити замовлення</button>;
  return part;
});

export function Chat({ ctx, plant }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const id = plant?.id;
  useEffect(() => {
    api.get(`/me/plants/${id}/chat`).then(setData).catch((e) => setError(errText(e)));
  }, [id]);

  // Нове повідомлення має бути видно без прокрутки — інакше відповідь
  // кавенятка з'являється за краєм екрана.
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages?.length, sending]);

  if (error && !data) return <div className="stage-pad"><div className="panel">{error}</div></div>;
  if (!data) return <div className="stage-pad"><div className="skeleton" /></div>;

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    // Показуємо репліку одразу: чекати на мережу, щоб побачити власний
    // текст, — найгірше, що може робити чат.
    const optimistic = { id: `tmp-${Date.now()}`, role: "user", body: message, created_at: new Date().toISOString() };
    setData((d) => ({ ...d, messages: [...d.messages, optimistic] }));
    setText("");
    try {
      const r = await api.post(`/me/plants/${id}/chat`, { message });
      setData((d) => ({
        ...d,
        messages: [...d.messages.filter((m) => m.id !== optimistic.id), ...r.messages],
        free_left: r.free_left,
        price: r.price,
      }));
      if (r.charged) await ctx.refreshMe();
    } catch (e) {
      setData((d) => ({ ...d, messages: d.messages.filter((m) => m.id !== optimistic.id) }));
      setText(message);
      if (e.body?.error === "not_enough_coins") {
        // Той самий попап «Бракує монет» зі способами їх отримати, що й на
        // будь-якій покупці (gamification_ui.md, попап нестачі), а не рядок
        // над полем вводу (власник, 03.10.2026).
        const b = ctx.me?.balances ?? {};
        ctx.notify(<NotEnoughCoins what="Повідомлення кавенятку" price={e.body.need ?? data.price}
                                   have={(b.silver ?? 0) + (b.yellow ?? 0)} ctx={ctx} onClose={() => ctx.notify(null)} />);
      } else {
        setError(errText(e));
      }
    } finally {
      setSending(false);
    }
  };

  let lastDay = null;

  return (
    <div className="chat">
      {/* Розмову гравця записи Clarity не показують (clarity.js). */}
      <div className="chat-log" data-clarity-mask="True">
        {/* Порожня історія — плашка посередині, як вступ у телеграм-боті, а
            не повідомлення від кавенятка: це підказка інтерфейсу, а не репліка,
            і вона зникає з першим же повідомленням (власник, 26.09.2026). */}
        {data.messages.length === 0 && (
          <div className="chat-intro">
            Кавенятко місцеве. Знає, як тут все працює, хто, що, і куди. Напиши йому –
            воно усе розповість, а заодно і розважить 😎
          </div>
        )}
        {data.messages.map((m) => {
          const day = dayLabel(m.created_at);
          const separator = day !== lastDay ? (lastDay = day) : null;
          return (
            <Fragment key={m.id}>
              {separator && <div className="chat-day">{separator}</div>}
              <div className={`chat-msg chat-${m.role}`}>{m.role === "system" ? <span>{withTokens(m.body, ctx)}</span> : m.body}</div>
            </Fragment>
          );
        })}
        {sending && <div className="chat-msg chat-plant chat-typing">друкую…</div>}
        <div ref={endRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}
      {data.blocked ? (
        <div className="chat-input"><p>{BLOCKED[data.blocked]}</p></div>
      ) : (
        <div className="chat-input">
            <>
              <textarea
                rows={1}
                value={text}
                placeholder="Написати…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <button className="chat-send" title="Надіслати" onClick={send}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15" /><path d="M13 6l6 6-6 6" /></svg>
                {/* Ціна — лише коли за повідомлення справді треба платити;
                    безкоштовні нічим не позначаємо (власник, 26.09.2026). */}
                {/* Платиться будь-якими монетами, спершу срібними — тому пара монет. */}
                {data.price > 0 && (
                  <span>
                    {data.price}
                    <span className="coins2">
                      <img src="/assets/ui/coin_silver.webp" alt="срібні монети" />
                      <img src="/assets/ui/coin_gold.webp" alt="золоті монети" style={{ marginLeft: -7 }} />
                    </span>
                  </span>
                )}
              </button>
            </>
        </div>
      )}
    </div>
  );
}
