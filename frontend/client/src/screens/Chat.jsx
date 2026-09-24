// Чат із кавенятком. Окрім розмови, це ще й стрічка сповіщень акаунта:
// продажі, нарахування, статуси замовлень приходять сюди системними
// репліками (gamification_ui §«Сповіщення» — пушів ми не робимо).
import { Fragment, useEffect, useRef, useState } from "react";
import { api, errText } from "../api.js";

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
      setError(e.body?.error === "not_enough_coins" ? "no_coins" : errText(e));
    } finally {
      setSending(false);
    }
  };

  let lastDay = null;

  return (
    <div className="chat">
      <div className="chat-log">
        {data.messages.length === 0 && (
          <div className="chat-msg chat-plant">
            Кавенятко знає, скільки в тебе монет, чого воно хоче далі й що ти купував.
            Спитай його – наприклад, «що мені робити зараз?».
          </div>
        )}
        {data.messages.map((m) => {
          const day = dayLabel(m.created_at);
          const separator = day !== lastDay ? (lastDay = day) : null;
          return (
            <Fragment key={m.id}>
              {separator && <div className="chat-day">{separator}</div>}
              <div className={`chat-msg chat-${m.role}`}>{m.body}</div>
            </Fragment>
          );
        })}
        {sending && <div className="chat-msg chat-plant chat-typing">думає…</div>}
        <div ref={endRef} />
      </div>

      {error && error !== "no_coins" && <div className="chat-error">{error}</div>}
      {data.blocked ? (
        <div className="chat-input"><p>{BLOCKED[data.blocked]}</p></div>
      ) : (
        <div className="chat-input">
          {error === "no_coins" ? (
            <>
              <p>Не вистачає монет на повідомлення.</p>
              <button className="pill pill-primary" onClick={() => ctx.openTab("shop")}>Поповнити</button>
            </>
          ) : (
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
                {data.price > 0
                  ? <span>{data.price}<img src="/assets/ui/coin_gold.png" alt="золота монета" /></span>
                  : <span>{data.free_left} безкоштовно</span>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
