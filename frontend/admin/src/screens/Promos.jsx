// Акції: бібліотека панелей для екрана кіоска (questions.md, питання 7).
//
// Поля тут — рівно ті, що вміє намалювати кіоск (raspberry/kiosk/src/menu.h):
// плашка, два рядки заголовка, акцентний рядок, дрібний рядок і напій, зі
// спрайта якого береться картинка. Нічого «на майбутнє» — усе зайве на
// екрані в залі просто не з'явиться.
//
// Поточна акція — одна, і вона завжди є: саме її бачить екран точки.
// Обрати іншу можна тут, одним натисканням — меню в бакеті перекладається
// саме собою, без деплойменту. Деплоймент лишився там, де він потрібен:
// на «Цінах», бо ціни їдуть ще й у машину та Checkbox.
import { useState } from "react";
import { api } from "../api.js";
import { Badge, Card, Empty, useData } from "../ui.jsx";
import { AdPreview } from "./AdPreview.jsx";

const KINDS = [
  ["promo", "Акція"],
  ["notice", "Оголошення"],
  ["news", "Новина"],
  ["none", "без плашки"],
];
const EMPTY = { kind: "promo", head1: "", head2: "", sub: "", fine: "", drink_code: "" };

export function Promos() {
  const { data, error, reload } = useData(() => api.promos());
  const drinks = useData(() => api.prices());
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);     // помилки форми — під формою
  const [flash, setFlash] = useState(null);   // відповідь на дію в бібліотеці — у бібліотеці

  if (error) return <Empty>не вдалось прочитати акції: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const reset = () => { setForm(EMPTY); setEditing(null); };

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const body = { ...form, drink_code: form.drink_code || null };
      if (editing) await api.promoSave(editing, body);
      else await api.promoAdd(body);
      reset();
      reload();
    } catch (e) {
      setNote(e.body?.error === "head1_required" ? "заголовок обовʼязковий" : e.message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (p) => {
    setEditing(p.id);
    setForm({ kind: p.kind, head1: p.head1, head2: p.head2 ?? "", sub: p.sub ?? "", fine: p.fine ?? "", drink_code: p.drink_code ?? "" });
  };

  const archive = async (p) => {
    try {
      await api.promoArchive(p.id);
      if (editing === p.id) reset();
      reload();
    } catch (e) {
      setFlash({ ok: false, text: e.body?.error === "promo_is_current"
        ? "це поточна акція — спершу зроби поточною іншу"
        : e.message });
    }
  };

  const makeCurrent = async (p) => {
    setBusy(true);
    setFlash(null);
    try {
      await api.promoSetCurrent(p.id);
      // Кажемо, ЩО саме поїхало на екран: без цього єдиний слід успіху —
      // бейдж, який зʼявляється десь у списку, і його легко не помітити.
      setFlash({ ok: true, text: `«${p.head1}» тепер на екрані — меню поїде на точку протягом хвилини` });
      reload();
    } catch (e) {
      setFlash({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <h1>Акції</h1>
        <p>панель на екрані точки · поточна міняється тут і одразу</p>
      </div>

      <div className="wrap-cols">
        <Card title={editing ? "Правимо акцію" : "Нова акція"}>
          <div className="promo-form">
            <label className="promo-field">
              <span>Плашка</span>
              <select value={form.kind} onChange={set("kind")}>
                {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className="promo-field">
              <span>Заголовок</span>
              <input value={form.head1} onChange={set("head1")} placeholder="Завтра шалений ранок" maxLength={64} />
            </label>
            <label className="promo-field">
              <span>Другий рядок</span>
              <input value={form.head2} onChange={set("head2")} placeholder="у extrovert.cafe" maxLength={64} />
            </label>
            <label className="promo-field">
              <span>Підзаголовок</span>
              <input value={form.sub} onChange={set("sub")} placeholder="еспресо на 20% дешевший" maxLength={64} />
            </label>
            <label className="promo-field">
              <span>Дрібним</span>
              <input value={form.fine} onChange={set("fine")} placeholder="діє до 12:00 в пʼятницю" maxLength={64} />
            </label>
            <label className="promo-field">
              <span>Напій</span>
              <select value={form.drink_code} onChange={set("drink_code")}>
                <option value="">без картинки</option>
                {(drinks.data?.drinks ?? []).map((d) => (
                  <option key={d.slot} value={d.slot}>{d.name}</option>
                ))}
              </select>
            </label>
            <AdPreview
              kind={form.kind}
              head1={form.head1}
              head2={form.head2}
              sub={form.sub}
              fine={form.fine}
              sprite={(drinks.data?.drinks ?? []).find((d) => d.slot === form.drink_code)?.sprite ?? ""}
            />
            <div className="promo-preview-note">
              Так це виглядатиме на екрані точки: той самий шаблон, шрифти й
              картинки, що й у кіоска, у масштабі 1:1. Довгий заголовок
              обрізається тут так само, як обріже кіоск, — але рівно на межі
              може розійтись на символ: браузер і точка міряють ширину тексту
              трохи по-різному (там же й ±1 px на ширині плашки).
            </div>
            {note && <div className="promo-note">{note}</div>}
            <div className="row">
              <button className="btn primary" disabled={busy || !form.head1.trim()} onClick={save}>
                {editing ? "Зберегти" : "Додати"}
              </button>
              {editing && <button className="btn" onClick={reset}>Скасувати</button>}
            </div>
          </div>
        </Card>

        <Card title="Бібліотека" note={`${data.promos.length} шт.`}>
          {flash && (
            <div className="promo-note" style={{ color: flash.ok ? "var(--ok)" : "var(--bad)", marginBottom: 8 }}>
              {flash.text}
            </div>
          )}
          {data.promos.length === 0 ? (
            <Empty>акцій ще немає</Empty>
          ) : (
            data.promos.map((p) => (
              <div key={p.id} className="promo-row">
                <div className="promo-main">
                  <div className="promo-head">
                    {p.kind !== "none" && <Badge tone="warn">{(KINDS.find(([v]) => v === p.kind) ?? [])[1]}</Badge>}
                    <b>{p.head1} {p.head2}</b>
                  </div>
                  <small>{p.sub || "—"}{p.fine ? ` · ${p.fine}` : ""}{p.drink_name ? ` · ${p.drink_name}` : ""}</small>
                  {p.used_at && <small className="muted">викотили {new Date(p.used_at).toLocaleDateString("uk-UA")}</small>}
                </div>
                <div className="promo-acts">
                  {p.is_current
                    ? <Badge tone="ok">на екрані</Badge>
                    : <button className="btn primary" disabled={busy} onClick={() => makeCurrent(p)}>Показати</button>}
                  <button className="btn" onClick={() => edit(p)}>Правити</button>
                  {!p.is_current && <button className="btn" onClick={() => archive(p)}>В архів</button>}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
