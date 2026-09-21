// Зміна нікнейма: поле, підказка від сервера й зрозуміла помилка.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Sheet } from "../ui/Sheet.jsx";

const ERRORS = {
  bad_nickname: "3–24 символи: букви, цифри, підкреслення й дефіс",
  nickname_taken: "Такий нікнейм уже зайнятий",
};

export function NicknameChange({ ctx }) {
  const [value, setValue] = useState(ctx.me?.nickname ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const suggest = () => api.get("/me/nickname/suggest").then((r) => { setValue(r.nickname); setError(null); });
  useEffect(() => { /* підказку не тягнемо одразу: поле вже має поточний нік */ }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/me/nickname", { nickname: value.trim() });
      await ctx.refreshMe();
      ctx.pop();
    } catch (e) {
      setError(ERRORS[e.body?.error] ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Твій нікнейм" onClose={ctx.pop}>
      <p className="muted" style={{ marginTop: 0 }}>
        Його бачать інші гравці на маркеті. Формат такий самий, як у згенерованого:
        прикметник, підкреслення й кавове слово.
      </p>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%", height: 48, padding: "0 14px", fontSize: 16, fontFamily: "inherit",
          borderRadius: "var(--radius-sm)", border: "1px solid var(--line)",
          background: "var(--panel2)", color: "var(--ink)",
        }}
      />
      {error && <div style={{ color: "var(--accent-text)", fontSize: 13, marginTop: 8 }}>{error}</div>}

      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <button className="btn" onClick={suggest}>Запропонувати інший</button>
        <button className="btn btn-primary" disabled={busy || !value.trim()} onClick={save}>
          {busy ? "Зберігаємо…" : "Зберегти"}
        </button>
      </div>
    </Sheet>
  );
}
