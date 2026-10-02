// Стан звʼязку — двома різними речами, бо це дві різні ситуації.
//
// Тост «Немає звʼязку» — реакція на конкретну дію: натиснув, а запит не
// дійшов. Один на весь застосунок (api.js кидає подію), бо раніше кожен
// екран писав те саме своїм блоком, і в підказці під кнопкою світилось
// «Failed to fetch».
//
// Той самий тост — і для будь-якої іншої відповіді на дію, якої людина
// має не пропустити: «посадка відкриється завтра», «не вистачає
// препарату» (власник, 02.10.2026). Рядок під кнопкою чи в картці легко не
// помітити, і тоді здається, що кнопка нічого не робить. toast(text) —
// звідки завгодно, без пропсів.
//
// Смужка зверху — навпаки, не про дію, а про фон: події перестали
// приходити. Показуємо її не одразу: під час викочування ws розривається
// на пів секунди (docs/deploy.md §2.3), і блимати смужкою на кожному
// деплої — це привчити не звертати на неї уваги.
import { useEffect, useState } from "react";

const TOAST_MS = 4000;
const OFFLINE = "Немає звʼязку. Спробуй ще раз";

export const toast = (text) => window.dispatchEvent(new CustomEvent("extrovert:toast", { detail: text }));

// Список не завантажився. Досі такі екрани показували «порожньо» —
// «Склад порожній», «0 пропозицій», вітрину без товарів, — тобто неправду,
// від якої гравець вирішував, що речі зникли (03.10.2026). Уже показані
// дані екрани не затирають, а цей блок — лише коли показати нічого.
export function LoadFailed({ onRetry }) {
  return (
    <div className="stage-pad">
      <div className="panel" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        Не вдалось завантажити – перевір звʼязок.
        {onRetry && <button className="pill pill-primary" onClick={onRetry}>Спробувати ще</button>}
      </div>
    </div>
  );
}
// Скільки терпіти мовчання ws, перш ніж сказати про це людині. Перепідключення
// після викочування вкладається в секунду з невеликим розкидом (ws.js).
const BANNER_AFTER_MS = 6000;

export function NetStatus({ wsOnline }) {
  const [message, setMessage] = useState(null);
  const [banner, setBanner] = useState(false);

  useEffect(() => {
    let hide = null;
    const show = (text) => {
      setMessage(text);
      clearTimeout(hide);
      hide = setTimeout(() => setMessage(null), TOAST_MS);
    };
    const onOffline = () => show(OFFLINE);
    const onToast = (e) => { if (e.detail) show(String(e.detail)); };
    window.addEventListener("extrovert:offline", onOffline);
    window.addEventListener("extrovert:toast", onToast);
    return () => {
      window.removeEventListener("extrovert:offline", onOffline);
      window.removeEventListener("extrovert:toast", onToast);
      clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    if (wsOnline !== false) { setBanner(false); return undefined; }
    const t = setTimeout(() => setBanner(true), BANNER_AFTER_MS);
    return () => clearTimeout(t);
  }, [wsOnline]);

  return (
    <>
      {banner && <div className="net-banner">Відновлюємо звʼязок…</div>}
      {message && <div className="net-toast" key={message} role="status">{message}</div>}
    </>
  );
}
