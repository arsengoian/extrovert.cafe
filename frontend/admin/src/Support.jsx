// Розділ «Підтримка»: треди з Telegram-бота (docs/services.md, «Підтримка
// через Telegram»). Зліва — хто пише, згори ті, де останнє слово за
// гравцем; справа — розмова й поле відповіді. Відповідь іде гравцю в
// Telegram від імені бота.
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { go } from "./app.jsx";
import { connectEvents } from "./ws.js";

const time = (iso) => (iso ? new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const who = (t) => t.nickname || (t.telegram_username ? `@${t.telegram_username}` : `чат ${t.telegram_chat_id ?? t.id}`);

// Вкладення лежать у Telegram; api віддає їх лише з токеном адміна, тож
// картинку тягнемо fetch-ем і показуємо з blob-адреси.
function Attachment({ file }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    try { setSrc(URL.createObjectURL(await api.supportFile(file.file_id))); }
    catch (e) { setError(e.message); }
  };
  if (error) return <span className="muted">вкладення недоступне: {error}</span>;
  if (!src) {
    return <button className="btn small" onClick={load}>{file.kind === "photo" ? "показати фото" : `файл${file.name ? ` «${file.name}»` : ""}`}</button>;
  }
  return file.kind === "photo"
    ? <img className="attach" src={src} alt="вкладення" />
    : <a href={src} download={file.name ?? "файл"}>завантажити{file.name ? ` «${file.name}»` : ""}</a>;
}

function Thread({ id, onChanged }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => api.supportThread(id).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setData(null); setError(null); load(); }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.supportReply(id, body);
      setText("");
      await load();
      onChanged();
    } catch (e) {
      setError(e.message === "support_not_connected" ? "SUPPORT_BOT_TOKEN не заданий — відповідати нема чим" : e.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    await api.supportStatus(id, status);
    await load();
    onChanged();
  };

  if (!data) return <p className="muted">{error ?? "завантажуємо…"}</p>;
  const t = data.thread;
  return (
    <div className="thread">
      <div className="row between">
        <div>
          <b>{who(t)}</b>
          <div className="muted small">
            {t.telegram_username ? `@${t.telegram_username} · ` : ""}
            {t.nickname ? "акаунт привʼязаний" : "без акаунта — людина знайшла бота сама"}
          </div>
        </div>
        <button className="btn" onClick={() => setStatus(t.status === "open" ? "closed" : "open")}>
          {t.status === "open" ? "Закрити" : "Відкрити знову"}
        </button>
      </div>
      <div className="messages">
        {data.messages.map((m) => (
          <div key={m.id} className={`msg ${m.direction}`}>
            {m.body && <div>{m.body}</div>}
            {(m.attachments ?? []).map((f) => <Attachment key={f.file_id} file={f} />)}
            <div className="muted small">{time(m.created_at)}{m.direction === "out" ? ` · ${m.admin_email ?? "бот"}` : ""}</div>
          </div>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Відповідь користувачу в Telegram" rows={3}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} />
      <div className="row">
        <button className="btn" disabled={busy || !text.trim()} onClick={send}>{busy ? "надсилаємо…" : "Надіслати"}</button>
        <span className="muted small">Ctrl+Enter</span>
        {error && <span className="muted">Не вдалось: {error}</span>}
      </div>
    </div>
  );
}

export function Support({ id = null }) {
  const [list, setList] = useState(null);
  const [status, setStatus] = useState("open");
  const [error, setError] = useState(null);
  // Обрана розмова живе в адресі (#/support/<id>), а не в стані: інакше
  // перезавантаження скидало її, і після кожного оновлення доводилось
  // шукати тред заново.
  const open = id ? Number(id) : null;

  const load = useCallback(() => api.supportThreads(status).then(setList).catch((e) => setError(e.message)), [status]);
  useEffect(() => { load(); }, [load]);

  // Нове повідомлення в підтримку приходить подією, а не опитуванням:
  // людина написала — розмова спливла в списку сама. Відкритий тред
  // перечитує себе сам (ключ нижче), тож тут досить оновити список.
  const [beat, setBeat] = useState(0);
  useEffect(() => connectEvents((e) => {
    if (e.event !== "support_message") return;
    load();
    setBeat((n) => n + 1);
  }), [load]);

  return (
    <section>
      <div className="head">
        <div>
          <h1>Підтримка · Telegram</h1>
          <p>
            {list && !list.connected
              ? "Бот не підключений: без SUPPORT_BOT_TOKEN повідомлення не приходять і відповіді не йдуть"
              : "розмови з бота · відповідь іде користувачу в Telegram від імені бота"}
          </p>
        </div>
        <div className="right">
          {[["open", "Відкриті"], ["closed", "Закриті"]].map(([s, label]) => (
            <button key={s} className={`btn${status === s ? " primary" : ""}`} onClick={() => { setStatus(s); go("support"); }}>{label}</button>
          ))}
          <button className="btn" onClick={load}>Оновити</button>
        </div>
      </div>
      {error && <p className="muted">Не вдалось: {error}</p>}
      <div className="support">
        <ul className="threads">
          {list?.threads.length === 0 && <li className="muted">Порожньо</li>}
          {list?.threads.map((t) => (
            <li key={t.id}>
              <button className={`thread-row${open === t.id ? " on" : ""}`} onClick={() => go(`support/${t.id}`)}>
                <span className="row between">
                  <b>{who(t)}</b>
                  {t.waiting && t.status === "open" && <span className="dot" title="чекає на відповідь" />}
                </span>
                <span className="muted small">
                  {t.last_direction === "out" ? "ви: " : ""}{t.last_body ?? (t.last_has_files ? "вкладення" : "")}
                </span>
                <span className="muted small">{time(t.last_at)}</span>
              </button>
            </li>
          ))}
        </ul>
        {open ? <Thread key={`${open}:${beat}`} id={open} onChanged={load} /> : <p className="muted">Оберіть розмову зліва.</p>}
      </div>
    </section>
  );
}
