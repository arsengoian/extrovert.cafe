// «Що не працює?» — скарга або ідея. Відкривається з HUD і зі стартового
// екрана, тобто працює і без входу (design: «Проблема»).
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { ResultPopup } from "../ui/Popup.jsx";

const CATEGORIES = [
  { id: "coffee_machine", label: "Кавомашина" },
  { id: "monitor", label: "Монітор" },
  { id: "site", label: "Сайт extrovert.cafe" },
  { id: "supplies", label: "Не вистачає матеріалів" },
  { id: "idea", label: "Хочу запропонувати ідею" },
];

export function Problem({ ctx }) {
  const [point, setPoint] = useState(null);
  // Перша категорія відмічена одразу — як у кадрі «Повідомити про проблему».
  const [picked, setPicked] = useState(["coffee_machine"]);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [photo, setPhoto] = useState(null);      // { key, name, preview }
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);

  // З фото поле деталей — за висотою тексту, як у кадрі «Проблема ·
  // заповнено»; без фото його розтягує flex.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "";
    if (photo) el.style.height = `${el.scrollHeight + 2}px`;
  }, [body, photo]);

  useEffect(() => { api.get("/points/current").then((r) => setPoint(r.point)).catch(() => {}); }, []);

  const toggle = (id) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  // Фото йде в бакет напряму за підписаним посиланням — api бачить лише
  // ключ. Так кілька мегабайтів не ходять через наш сервер.
  const pickPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const link = await api.post("/problems/photo-url", { content_type: file.type, size: file.size });
      const res = await fetch(link.upload_url, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`сховище відповіло ${res.status}`);
      setPhoto({ key: link.key, name: file.name, size: file.size, preview: URL.createObjectURL(file) });
    } catch (e) {
      const code = e.body?.error;
      setError(code === "bad_type" ? "Підійде JPEG, PNG або WebP"
        : code === "too_big" ? "Фото завелике – до 8 МБ"
        : code === "unauthorized" ? "Щоб додати фото, спершу увійди"
        : e.message);
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/problems", {
        categories: picked, body, point_id: point?.id ?? null, image_key: photo?.key ?? null,
      });
      setSent(true);
    } catch (e) {
      setError(e.body?.error === "empty_report" ? "Оберіть, що саме не працює, або опишіть словами" : e.message);
    } finally {
      setBusy(false);
    }
  };

  const mb = (b) => (b / 1024 / 1024).toFixed(1).replace(".", ",");

  return (
    <div className="form18">
      <div className="field">
        <div className="sectionTitle">Точка</div>
        <div className="select-field">
          <span>{point ? `${point.name} · ${point.short_address ?? point.address}` : "—"}</span>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9.5 12 15.5 18 9.5" />
          </svg>
        </div>
      </div>

      <div className="field">
        <div className="sectionTitle">Що саме</div>
        <div className="list-card">
          {CATEGORIES.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} className="check-row" aria-pressed={on} onClick={() => toggle(c.id)}>
                <i>
                  {on && (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
                      <path d="M5 12.5 10 17.5 19.5 7" />
                    </svg>
                  )}
                </i>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Без фото поле тягнеться на весь залишок екрана, а «Додати фото» —
          велика кнопка; з фото поле за вмістом і під ним рядок файлу
          (кадри «Повідомити про проблему» і «Проблема · заповнено»). */}
      <div className={`field details-field${photo ? "" : " grow"}`}>
        <div className="sectionTitle">Деталі</div>
        <textarea ref={bodyRef} className="textarea details" value={body} rows={1}
                  placeholder="Опишіть, що трапилося" onChange={(e) => setBody(e.target.value)} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
               onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        {photo && (
          <div className="file-row">
            <img src={photo.preview} alt="" />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <b>{photo.name}</b>
              <small>{mb(photo.size)} МБ · завантажено</small>
            </div>
            <button aria-label="Прибрати фото" onClick={() => setPhoto(null)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
              </svg>
            </button>
          </div>
        )}
        <button className={`dashed-btn${photo ? "" : " big"}`} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {photo ? (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 6v12M6 12h12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3.5" y="5.5" width="17" height="13" rx="2.6" /><circle cx="12" cy="12" r="3.2" />
            </svg>
          )}
          {uploading ? "Завантажуємо…" : photo ? "Ще фото" : "Додати фото"}
        </button>
      </div>

      {error && <div className="panel" style={{ color: "var(--accent-text)" }}>{error}</div>}

      <button className={`cta send${photo ? "" : " flush"}`} disabled={busy} onClick={send}>{busy ? "Надсилаємо…" : "Надіслати"}</button>

      {sent && (
        <ResultPopup
          art={<img src="/assets/ui/nav_problem.png" alt="" style={{ width: 52, height: 50 }} />}
          title="Дякуємо, побачили"
          onClose={ctx.pop}
        >
          <div className="result-note">Ми читаємо все, що сюди приходить. Якщо знадобляться деталі – напишемо в підтримку.</div>
        </ResultPopup>
      )}
    </div>
  );
}
