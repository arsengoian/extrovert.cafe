// Стан звʼязку — двома різними речами, бо це дві різні ситуації.
//
// Тост «Немає звʼязку» — реакція на конкретну дію: натиснув, а запит не
// дійшов. Один на весь застосунок (api.js кидає подію), бо раніше кожен
// екран писав те саме своїм блоком, і в підказці під кнопкою світилось
// «Failed to fetch».
//
// Смужка зверху — навпаки, не про дію, а про фон: події перестали
// приходити. Показуємо її не одразу: під час викочування ws розривається
// на пів секунди (docs/deploy.md §2.3), і блимати смужкою на кожному
// деплої — це привчити не звертати на неї уваги.
import { useEffect, useState } from "react";

const TOAST_MS = 4000;
// Скільки терпіти мовчання ws, перш ніж сказати про це людині. Перепідключення
// після викочування вкладається в секунду з невеликим розкидом (ws.js).
const BANNER_AFTER_MS = 6000;

export function NetStatus({ wsOnline }) {
  const [toast, setToast] = useState(false);
  const [banner, setBanner] = useState(false);

  useEffect(() => {
    let hide = null;
    const onOffline = () => {
      setToast(true);
      clearTimeout(hide);
      hide = setTimeout(() => setToast(false), TOAST_MS);
    };
    window.addEventListener("extrovert:offline", onOffline);
    return () => {
      window.removeEventListener("extrovert:offline", onOffline);
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
      {toast && <div className="net-toast">Немає звʼязку. Спробуй ще раз</div>}
    </>
  );
}
