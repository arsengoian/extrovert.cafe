// «Ім'я нового кавенятка»: картка знизу над небом — паросток на платформі
// з подякою, поле з лічильником і «Готово». HUD і нижнє меню — під тим
// самим розмиттям, що й у попапів. Ім'я бачить лише власник, тому перевірок
// мінімум — на відміну від нікнейма, який унікальний.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errText } from "../api.js";
import { usePlantAssets } from "../plant/assets.js";
import { buildScene } from "../plant/scene.js";
import { Scene } from "../plant/Scene.jsx";

const MAX = 16;

export function PlantName({ plant, ctx }) {
  const assets = usePlantAssets();
  const [name, setName] = useState(plant?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Попап живе в порталі над застосунком, а не всередині .stage.
  //
  // 23.09.2026 саме через це тестери залипали на розмитому екрані без
  // жодної кнопки: затемнення (.sheet-backdrop, z-index 150) портал клав у
  // .app, а картку лишав у скролері .stage. На десктопі .stage свого
  // контексту накладання не створює, тож картка з z-index 160 лягала
  // зверху; на телефоні -webkit-overflow-scrolling: touch робить зі скролера
  // окремий контекст — і вся картка разом із «Готово» опинялась ПІД
  // затемненням. Усі інші попапи застосунку й так портальні (ui/Popup.jsx),
  // цей був єдиним винятком.
  //
  // Небо розтягуємо рівно на тіло екрана, як було: HUD і нижнє меню мають
  // лишитись видимими крізь розмиття.
  const [host, setHost] = useState(null);
  const [box, setBox] = useState(null);
  useEffect(() => setHost(document.querySelector(".app")), []);
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    const stage = document.querySelector(".stage");
    if (!app || !stage) return;
    const a = app.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    // І по боках теж: у ландшафті тіло екрана — між двома смугами меню,
    // і небо має лягти саме на нього, лишивши смуги видимими.
    setBox({ top: s.top - a.top, bottom: a.bottom - s.bottom, left: s.left - a.left, right: a.right - s.right });
  }, []);

  // Клавіатура на iPhone не стискає сторінку, а лягає поверх неї: картка
  // внизу неба опинялась під клавіатурою разом із полем. Тож низ неба
  // піднімаємо на висоту клавіатури (visualViewport), картка стає нижчою й
  // прокручується, а поле прокручуємо у видиму частину — паросток угорі
  // просто їде в скрол, а не стискається (власник, 01.10.2026).
  const [keyboard, setKeyboard] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      if (document.activeElement === input.current) input.current?.scrollIntoView({ block: "center" });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/me/plants/${plant.id}`, { name: name.trim() });
      ctx.pop();
    } catch (e) {
      setError(e.body?.error === "empty_name" ? "Ім'я не може бути порожнім" : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const sprout = assets ? buildScene({ layout: assets.layout, appearance: {}, stage: 0 }).filter((i) => i.group !== "platform") : [];
  if (!host) return null;
  return createPortal(
    <>
      {/* Ні «Пізніше», ні закриття по затемненню: дати ім'я потім було
          ніде, і кавенятко лишалось безіменним назавжди (власник,
          28.09.2026). */}
      <div className="sheet-backdrop" />
      <div className="name-sky" style={box ? { ...box, bottom: Math.max(box.bottom, keyboard) } : undefined}>
      <div className="name-card">
        <div className="name-hero">
          <img className="name-platform" src="/assets/ui/platform.png" alt="" />
          <div className="name-scene">
            {assets && <Scene instances={sprout} layout={assets.layout} camera={{ k: 0.185, tx: 0, ty: 0 }} />}
          </div>
          <div className="name-bubble">Дякую, що подарував мені життя! Я буду твоїм найкращим другом</div>
        </div>
        <div className="name-form">
          <b>Як його звати?</b>
          <label className="name-field">
            <input ref={input} value={name} autoFocus maxLength={MAX} spellCheck={false} autoComplete="off"
                   onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center" }), 350)}
                   onChange={(e) => { setName(e.target.value.slice(0, MAX)); setError(null); }} />
            <span>{name.length} / {MAX}</span>
          </label>
          <p>{error ?? "Ім'я бачитимеш тільки ти – його можна змінити будь-коли."}</p>
          <button className="cta" disabled={busy || !name.trim()} onClick={save}>Готово</button>
        </div>
      </div>
      </div>
    </>,
    host
  );
}
