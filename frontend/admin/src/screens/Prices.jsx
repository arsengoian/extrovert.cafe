// Ціни: поточний прайс і чернетка деплою (docs/admin_panel.md, «Ціни»).
//
// Ціна живе в `drinks`; деплоймент бере знімок і котить його на точки та в
// Checkbox (services.md §4). Тут можна змінити ціну в чернетці й поставити
// деплой у чергу — далі його веде scheduler, а екран «Деплойменти» показує,
// що з ним сталось.
import { useMemo, useState } from "react";
import { api } from "../api.js";
import { Badge, Card, Empty, Table, fmt, useData } from "../ui.jsx";

const STATUS = {
  queued: ["", "у черзі"], deploying: ["warn", "котиться"], done: ["ok", "готово"],
  partial: ["warn", "частково"], failed: ["bad", "впало"], current: ["ok", "поточний"],
};
const badge = (s) => { const [tone, text] = STATUS[s] ?? ["", s]; return <Badge tone={tone}>{text}</Badge>; };

export function Prices() {
  const { data, error, reload } = useData(() => api.prices());
  const [draft, setDraft] = useState({});
  const [targets, setTargets] = useState(null);       // null = усі точки
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  // Напій, який збираються сховати чи повернути. Питаємо підтвердження:
  // вимкнений напій зникає з екрана точки одразу після наступного
  // викочування, а ввімкнений — з'являється, і обидва боки помітні людям
  // у залі.
  const [toggle, setToggle] = useState(null);

  const changed = useMemo(
    () => (data?.drinks ?? []).filter((d) => draft[d.id] !== undefined && Number(draft[d.id]) !== Number(d.price_uah)),
    [data, draft]
  );

  if (error) return <Empty>не вдалось прочитати ціни: {error.message}</Empty>;
  if (!data) return <Empty>вантажимо…</Empty>;

  const flip = async () => {
    const d = toggle;
    setToggle(null);
    setBusy(true);
    setNote(null);
    try {
      await api.savePrices([{ id: d.id, price_uah: Number(d.price_uah), active: !d.active }]);
      setNote(`${d.name}: ${d.active ? "сховано з меню" : "повернено в меню"} — поїде з наступним викочуванням`);
      reload();
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deploy = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (changed.length) {
        await api.savePrices(changed.map((d) => ({ id: d.id, price_uah: Number(draft[d.id]) })));
      }
      const r = await api.deployMenu({ points: targets });
      setNote(`деплоймент №${r.id} у черзі: ${r.points.length} точк(и). Ціни збережені — scheduler бере їх із бази.`);
      setDraft({});
      reload();
    } catch (e) {
      setNote(`не вийшло: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const last = data.last_deployment;

  return (
    <>
      <div className="head">
        <div>
          <h1>Ціни · чернетка деплою</h1>
          <p>{data.drinks.length} позицій меню · зміни котяться на точки й у Checkbox одним деплойментом</p>
        </div>
        <div className="right">
          <label className="field">
            <select value={targets === null ? "" : targets[0]} onChange={(e) => setTargets(e.target.value ? [e.target.value] : null)}>
              <option value="">усі точки ({data.points.length})</option>
              {data.points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="btn primary" disabled={busy} onClick={deploy}>
            {busy ? "Ставимо…" : changed.length ? `Зберегти й викотити (${changed.length})` : "Викотити меню"}
          </button>
        </div>
      </div>

      {note && <Card className="" style={{ marginBottom: 12 }}><span className="muted">{note}</span></Card>}

      {toggle && (
        <div className="confirm-back" onClick={() => setToggle(null)}>
          <div className="confirm" onClick={(e) => e.stopPropagation()}>
            <b>{toggle.active ? "Сховати з меню?" : "Повернути в меню?"}</b>
            <p>
              {toggle.name} ({toggle.system_code}).{" "}
              {toggle.active
                ? "Картка зникне з екрана точки після наступного викочування меню. У касі товар лишиться."
                : "Картка з'явиться на екрані точки після наступного викочування меню."}
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setToggle(null)}>Скасувати</button>
              <button className="btn primary" onClick={flip}>{toggle.active ? "Сховати" : "Повернути"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="wrap-cols">
        <Table
          columns={[
            { key: "name", title: "напій", render: (d) => <span><b>{d.name}</b><small>{d.system_code} · {d.vol ?? "—"}</small></span> },
            {
              key: "price_uah", title: "ціна, ₴", num: true, render: (d) => (
                <input
                  className="field"
                  style={{ width: 84, height: 28, textAlign: "right", padding: "0 8px" }}
                  value={draft[d.id] ?? d.price_uah}
                  onChange={(e) => setDraft({ ...draft, [d.id]: e.target.value })}
                  inputMode="decimal"
                />
              ),
            },
            // Одне число на обидва випадки: у звичайного напою це заробіток
            // гравця, у бонусного — ціна. Що саме — каже колонка поруч.
            { key: "coins", title: "монет", num: true },
            { key: "is_bonus", title: "за монети", render: (d) => (d.is_bonus ? <Badge tone="warn">бонусний</Badge> : <span className="muted">—</span>) },
            {
              key: "active", title: "стан", render: (d) => (
                <button className="btn" style={{ height: 26 }} onClick={() => setToggle(d)}>
                  {d.active ? <Badge tone="ok">у меню</Badge> : <Badge>сховано</Badge>}
                </button>
              ),
            },
          ]}
          rows={data.drinks}
          empty="у базі немає напоїв — залий сіди (bun run seed:apply)"
        />

        <Card title="Останній деплоймент" note={last ? fmt.time(last.created_at) : "ще не було"}>
          {!last ? (
            <Empty>деплойментів ще не було</Empty>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <b>№{last.id}</b>
                {badge(last.status)}
              </div>
              {last.targets.length === 0 && <Empty>цілей немає</Empty>}
              {last.targets.map((t) => (
                <div key={`${t.point_id}-${t.kind}`} className="row" style={{ justifyContent: "space-between", padding: "5px 0", fontSize: 11.5 }}>
                  <span>{t.name} <span className="muted">· {t.kind}</span></span>
                  <span className="row" style={{ gap: 7 }}>
                    {t.error && <span className="muted" title={t.error}>помилка</span>}
                    {badge(t.status)}
                  </span>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
