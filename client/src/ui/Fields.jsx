// Поля форм із дизайну: список варіантів (один або кілька), сегментований
// перемикач і текстове поле. Один набір на всі квізи й форми — інакше
// кожен екран малював би свої кружечки.
export function Choice({ options, value, onChange, multi = false }) {
  const picked = (o) => (multi ? (value ?? []).includes(o) : value === o);
  const toggle = (o) => {
    if (!multi) return onChange(o);
    const list = value ?? [];
    onChange(list.includes(o) ? list.filter((x) => x !== o) : [...list, o]);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {options.map((o) => {
        const on = picked(o);
        return (
          <button key={o} className="row" style={{ width: "100%", textAlign: "left", padding: "8px 0" }}
                  onClick={() => toggle(o)} aria-pressed={on}>
            <span style={{
              width: 22, height: 22, flex: "none",
              borderRadius: multi ? 7 : 999,
              border: on ? 0 : "1px solid var(--line)",
              background: on ? "var(--grad)" : "var(--panel2)",
              color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {on ? (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                     strokeWidth="3.2" strokeLinecap="round"><path d="M5 12.5 10 17.5 19.5 7" /></svg>
              ) : null}
            </span>
            <span>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Segment({ options, value, onChange }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} className="btn" style={{
            height: 38, fontSize: 13, padding: "0 10px",
            background: on ? "var(--grad)" : "var(--panel2)",
            color: on ? "var(--accent-ink)" : "var(--ink)",
            border: on ? 0 : "1px solid var(--line)",
          }} onClick={() => onChange(o)} aria-pressed={on}>{o}</button>
        );
      })}
    </div>
  );
}

export function TextField({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: 12, fontSize: 15, fontFamily: "inherit", resize: "vertical",
        borderRadius: "var(--radius-sm)", border: "1px solid var(--line)",
        background: "var(--panel2)", color: "var(--ink)",
      }}
    />
  );
}
