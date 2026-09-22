// Адмінка. Зведені числа з api (/admin/overview), перший справжній розділ —
// «Підтримка» (переписка з Telegram-бота) — і перелік розділів, яких ще
// немає. Решта навмисно нічого не змінює: кнопка «видалити» без екрана, що
// пояснює наслідки, небезпечніша за відсутню адмінку.
import { useCallback, useEffect, useState } from "react";
import { api, devLoginPossible, getToken } from "./api.js";
import { Support } from "./Support.jsx";

// Список розділів тут, а не в доці: хай заглушка сама каже, чого в ній ще
// немає.
const SECTIONS = [
  ["Точки", "чеки, мовчання автомата, телеметрія"],
  ["Гравці", "пошук за нікнеймом, історія балансу, бани"],
  ["Доставки", "замовлення за зерна, статуси Нової Пошти"],
  ["Економіка", "курс зерна, ціни, ліміти — зараз усе в backend/api/data/economy.json"],
];

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.overview());
    } catch (e) {
      setData(null);
      setError(e.status === 401 ? "unauthorized" : e.message);
    }
  }, []);

  useEffect(() => { if (getToken()) load(); else setError("unauthorized"); }, [load]);

  const devLogin = async () => {
    setBusy(true);
    try {
      await api.devLogin();
      await load();
    } catch (e) {
      setError(e.status === 404 ? "девелоперський вхід вимкнений на цьому api" : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <h1>Адмінка</h1>
      <p className="muted">
        Статика на Workers, дані з api, як і в застосунку гравця. Поки що —
        зведені числа й підтримка; решта розділів нижче.
      </p>

      {error === "unauthorized" && (
        <>
          <h2>Вхід</h2>
          <p className="muted">
            Справжнього входу ще немає: він зʼявиться разом із першими екранами —
            пошта з паролем із <code>admin_users</code> або той самий Google.
          </p>
          {devLoginPossible && (
            <div className="row">
              <button className="btn" onClick={devLogin} disabled={busy}>
                {busy ? "заходимо…" : "Девелоперський вхід"}
              </button>
              <span className="muted">працює лише проти локального api</span>
            </div>
          )}
        </>
      )}

      {error && error !== "unauthorized" && <p className="muted">Не вдалось: {error}</p>}

      {data && (
        <>
          <div className="grid">
            {data.counts.map((c) => (
              <div className="card" key={c.key}>
                <div className="n">{c.value === null ? "—" : c.value}</div>
                <div className="muted">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={load}>Оновити</button>
            <button className="btn" onClick={() => { api.logout(); setData(null); setError("unauthorized"); }}>
              Вийти
            </button>
            <span className="muted">{new Date(data.at).toLocaleTimeString("uk-UA")}</span>
          </div>
        </>
      )}

      {data && <Support />}

      <h2>Що тут буде</h2>
      <ul>
        {SECTIONS.map(([name, what]) => (
          <li key={name}>
            <b>{name}</b> — <span className="muted">{what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
