// «Ім'я нового кавенятка»: картка знизу над небом — паросток на платформі
// з подякою, поле з лічильником і «Готово». HUD і нижнє меню — під тим
// самим розмиттям, що й у попапів. Ім'я бачить лише власник, тому перевірок
// мінімум — на відміну від нікнейма, який унікальний.
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
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
    setBox({ top: s.top - a.top, bottom: a.bottom - s.bottom });
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/me/plants/${plant.id}`, { name: name.trim() });
      ctx.pop();
    } catch (e) {
      setError(e.body?.error === "empty_name" ? "Ім'я не може бути порожнім" : e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  const sprout = assets ? buildScene({ layout: assets.layout, appearance: {}, stage: 0 }).filter((i) => i.group !== "platform") : [];
  if (!host) return null;
  return createPortal(
    <>
      {/* Клік по затемненню закриває: ім'я можна дати й пізніше, а екран,
          з якого нема виходу, — гірше за кавенятко без імені. */}
      <div className="sheet-backdrop" onClick={ctx.pop} />
      <div className="name-sky" style={box ?? undefined}>
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
            <input value={name} autoFocus maxLength={MAX} spellCheck={false} autoComplete="off"
                   onChange={(e) => { setName(e.target.value.slice(0, MAX)); setError(null); }} />
            <span>{name.length} / {MAX}</span>
          </label>
          <p>{error ?? "Ім'я бачитимеш тільки ти – його можна змінити будь-коли."}</p>
          <button className="cta" disabled={busy || !name.trim()} onClick={save}>Готово</button>
          <button className="name-later" onClick={ctx.pop}>Пізніше</button>
        </div>
      </div>
      </div>
    </>,
    host
  );
}
