// Посилання з листа відкрили не в тому браузері, де просили вхід (docs/
// services.md §3, «Вхід гравця»). Найчастіше — у вікні Gmail, яке на iPhone
// не ділить сховище з Safari: раніше людина входила всередині Gmail, а в
// Safari лишалась поза акаунтом. Тепер цей екран підтверджує вхід, і
// вкладка, яка просила лист, входить сама (власник, 27.09.2026: «екран, який
// каже, що вхід успішно підтверджено, і пропонує повернутися у браузер»).
//
// Перед підтвердженням питаємо «Це ти входиш?» і показуємо пристрій:
// вхід тепер дістається тій вкладці, яка просила лист, і без питання
// чужий міг би попросити лист на твою пошту й чекати, поки ти натиснеш.
//
// Кадру в макеті немає — зібрано з деталей екрана «Лист уже летить».
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Img } from "../ui/img.jsx";

const ago = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 1 ? "щойно" : `${min} хв тому`;
};

// onDone(result) — іти в застосунок у цьому браузері (result від verify)
// або на стартовий екран (null).
export function LoginConfirm({ token, onDone }) {
  const [step, setStep] = useState("loading");     // loading | ask | done | rejected | expired
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    api.emailPeek(token)
      .then(async (p) => {
        if (!alive) return;
        // Прохання без вкладки-прохача (старий лист) — просто входимо тут,
        // як було до цього екрана.
        if (!p.waiting) { onDone(await api.emailVerify(token)); return; }
        setInfo(p);
        setStep("ask");
      })
      .catch(() => alive && setStep("expired"));
    return () => { alive = false; };
  }, [token]);

  const yes = async () => {
    setBusy(true);
    try {
      setResult(await api.emailVerify(token));
      setStep("done");
    } catch {
      setStep("expired");
    } finally {
      setBusy(false);
    }
  };

  const no = async () => {
    setBusy(true);
    await api.emailReject(token).catch(() => {});
    setBusy(false);
    setStep("rejected");
  };

  if (step === "loading") return <div className="stage-pad"><div className="skeleton" /></div>;

  const screen = (title, lead, actions) => (
    <div className="form18" style={{ gap: 16 }}>
      <div className="email-sent">
        <Img src="/assets/ui/hero_bush.png" sizes="132px" alt="" />
        <b>{title}</b>
        <div className="lead14">{lead}</div>
      </div>
      {actions}
    </div>
  );

  if (step === "ask") {
    return screen(
      "Це ти входиш?",
      <>Вхід в акаунт <b>{info.email}</b> попросили з пристрою <b>{info.device}</b>, {ago(info.requested_at)}.</>,
      <>
        <button className="cta send start-cta" disabled={busy} onClick={yes}>Так, це я</button>
        <button className="btn" disabled={busy} onClick={no}>Ні, не я</button>
      </>
    );
  }

  if (step === "done") {
    return screen(
      "Вхід підтверджено",
      "Повертайся в браузер, де вводив пошту, – там ти вже всередині. Цю сторінку можна закрити.",
      <button className="btn" onClick={() => onDone(result)}>Продовжити тут</button>
    );
  }

  if (step === "rejected") {
    return screen(
      "Вхід скасовано",
      "Посилання більше не діє, і в акаунт ніхто не увійшов. Якщо такі листи приходитимуть знову – напиши в підтримку.",
      <button className="btn" onClick={() => onDone(null)}>На головну</button>
    );
  }

  return screen(
    "Посилання вже не діє",
    "Воно застаріло або вже використане – надішли нове зі сторінки входу.",
    <button className="btn" onClick={() => onDone(null)}>На головну</button>
  );
}
