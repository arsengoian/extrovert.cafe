// Розсилки новин у чат кавенятка (gamification_ui.md, «Сповіщення»;
// власник 03.10.2026). Кожен гравець отримує рядок у чат того кавенятка, чий
// чат відкривав останнім; без кавенятка — рядок чекає першого куща. Відправка
// незворотна, тож перед нею — підтвердження з кількістю отримувачів.
import { useState } from "react";
import { api } from "../api.js";
import { Card, Empty, Table, fmt, useData } from "../ui.jsx";

export function Broadcasts() {
  const { data, error, reload } = useData(() => api.broadcasts(), []);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const send = async () => {
    const n = data?.audience ?? 0;
    if (!window.confirm(`Надіслати «${title.trim()}» ${n} ${fmt.plural(n, "гравцю", "гравцям", "гравцям")}? Скасувати розсилку не можна.`)) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.broadcastSend({ title, body });
      setNote(`Надіслано: ${fmt.int(r.recipients)} ${fmt.plural(r.recipients, "гравець", "гравці", "гравців")}`);
      setTitle("");
      setBody("");
      reload();
    } catch (e) {
      setNote(`Не вдалось: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Розсилки</h1>
          <p>Новина приходить кожному гравцю в чат кавенятка{data ? ` · зараз гравців: ${fmt.int(data.audience)}` : ""}</p>
        </div>
      </div>

      <div className="grid k2">
        <Card title="Нова розсилка">
          <div className="promo-form">
            <label className="promo-field">
              <span>Заголовок</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Нова точка на Подолі" maxLength={120} />
            </label>
            <label className="promo-field" style={{ alignItems: "start" }}>
              <span style={{ paddingTop: 8 }}>Текст</span>
              <textarea className="broadcast-text" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={1500}
                        placeholder="З понеділка кава й на Контрактовій. Приходь — перший напій з подвійними бонусами." />
            </label>
            {/* Так рядок виглядатиме в чаті: заголовок першим рядком, текст під ним. */}
            {(title.trim() || body.trim()) && (
              <div className="broadcast-preview">
                <b>{title.trim()}</b>
                <span>{body.trim()}</span>
              </div>
            )}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn primary" disabled={busy || !title.trim() || !body.trim()} onClick={send}>
                {busy ? "Надсилаємо…" : "Надіслати всім"}
              </button>
              {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
            </div>
          </div>
        </Card>

        <Card title="Надіслані" note="останні 50">
          {error ? <Empty>{error.message}</Empty> : (
            <Table rows={data?.broadcasts ?? []} empty="розсилок ще не було" columns={[
              { key: "sent_at", title: "Коли", render: (r) => (r.sent_at ? fmt.time(r.sent_at) : "—") },
              { key: "title", title: "Заголовок", render: (r) => <span title={r.body}>{r.title}</span> },
              { key: "recipients", title: "Отримали", num: true, render: (r) => fmt.int(r.recipients ?? 0) },
              { key: "author", title: "Хто", render: (r) => r.author ?? "—" },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}
