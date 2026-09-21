// «Ім'я нового кавенятка»: картка знизу над небом — паросток на платформі
// з подякою, поле з лічильником і «Готово». HUD і нижнє меню — під тим
// самим розмиттям, що й у попапів. Ім'я бачить лише власник, тому перевірок
// мінімум — на відміну від нікнейма, який унікальний.
import { useEffect, useState } from "react";
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
  const [host, setHost] = useState(null);
  useEffect(() => setHost(document.querySelector(".app")), []);

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
  return (
    <div className="name-sky">
      {host && createPortal(<div className="sheet-backdrop" />, host)}
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
        </div>
      </div>
    </div>
  );
}
