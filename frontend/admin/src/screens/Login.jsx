// Вхід в адмінку: пошта й пароль із admin_users (docs/services.md §3).
// Форми «зареєструватися» немає навмисно — адміна заводить
// `docker compose exec api bun run admin add --email ...`.
import { useState } from "react";
import { api } from "../api.js";

const ERRORS = {
  bad_credentials: "Пошта або пароль не підходять",
  too_many_tries: "Забагато спроб — спробуй за чверть години",
};

export function Login({ onIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIn(await api.login(email.trim(), password));
    } catch (err) {
      setError(ERRORS[err.body?.error] ?? (err.status ? err.message : "Немає звʼязку з api"));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" />
          <span><b>extrovert.cafe</b><small>АДМІНКА</small></span>
        </div>
        <h1>Вхід</h1>
        <label className="field">
          <input type="email" placeholder="пошта" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <input type="password" placeholder="пароль" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="err">{error}</div>}
        <button className="btn primary" disabled={busy || !email || !password}>{busy ? "Заходимо…" : "Увійти"}</button>
        {api.devLogin && (
          <button type="button" className="btn" onClick={() => api.devLogin().then(onIn).catch((e) => setError(e.message))}>
            Девелоперський вхід
          </button>
        )}
      </form>
    </div>
  );
}
