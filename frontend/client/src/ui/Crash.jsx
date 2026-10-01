// Помилка рендеру — замість білого екрана. Без цієї межі React знімає все
// дерево, і гравець бачить порожню сторінку без жодної кнопки, а ми — нічого.
// Тепер падіння йде в GlitchTip разом зі стеком компонентів, а людині
// лишається одна дія: перезавантажити.
import { Component } from "react";
import { captureError } from "../errors.js";

export class Crash extends Component {
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
      <div className="stage-pad" style={{ justifyContent: "center", textAlign: "center", minHeight: "100vh" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <b>Щось пішло не так</b>
          <span className="muted">Ми вже знаємо про це. Перезавантаж сторінку – усе збережене на місці.</span>
          <button className="cta" onClick={() => window.location.reload()}>Перезавантажити</button>
        </div>
      </div>
    );
  }
}
