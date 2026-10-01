import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { captureError, initErrors } from "./errors.js";
import "./theme.css";

// Першим — щоб і помилки решти ініціалізації дійшли в GlitchTip.
initErrors("admin");

// Помилка рендеру — замість білого екрана: падіння йде в GlitchTip зі
// стеком компонентів, а на екрані лишається кнопка «Перезавантажити».
class Crash extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    captureError(error, { level: "fatal", tags: { kind: "render" }, extra: { componentStack: info?.componentStack?.slice(0, 4000) } });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 420, margin: "80px auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <b>Адмінка впала</b>
        <span>Помилка вже в GlitchTip. Перезавантаж сторінку.</span>
        <button className="btn" onClick={() => window.location.reload()}>Перезавантажити</button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>
);
