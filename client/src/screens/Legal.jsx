// Умови, приватність і підтримка. Один компонент на три екрани: у дизайні
// вони відрізняються лише вкладкою зверху й текстом, який приходить з api.
import { useEffect, useState } from "react";
import { api } from "../api.js";

export function Legal({ doc = "terms", ctx }) {
  const [tab, setTab] = useState(doc);
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(null);

  useEffect(() => { api.get("/legal").then(setIndex).catch(() => setIndex(null)); }, []);
  useEffect(() => {
    if (tab === "support") { setData(null); return; }
    api.get(`/legal/${tab}`).then(setData).catch(() => setData(null));
  }, [tab]);

  const tabStyle = (on) => ({
    flex: 1, height: 38, fontSize: 13,
    ...(on ? { background: "var(--grad)", color: "var(--accent-ink)", border: 0 } : {}),
  });

  return (
    <div className="stage-pad">
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn" style={tabStyle(tab === "terms")} onClick={() => setTab("terms")}>Умови</button>
        <button className="btn" style={tabStyle(tab === "privacy")} onClick={() => setTab("privacy")}>Приватність</button>
        <button className="btn" style={tabStyle(tab === "support")} onClick={() => setTab("support")}>Підтримка</button>
      </div>

      {tab === "support" ? (
        <div className="panel">
          <div className="h2">{index?.support?.title ?? "Підтримка"}</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{index?.support?.body}</p>
          <button className="btn btn-primary" onClick={() => ctx.push("problem")}>Повідомити про проблему</button>
        </div>
      ) : !data ? (
        <div className="skeleton" />
      ) : (
        <>
          {data.sections.map((s) => (
            <div key={s.heading} className="panel">
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{s.heading}</div>
              {s.body.split("\n\n").map((p) => (
                <p key={p.slice(0, 24)} className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 8px" }}>{p}</p>
              ))}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>Редакція від {data.updated}</p>
        </>
      )}
    </div>
  );
}
