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
  // Порядок карток на екрані точки. Кіоск не сортує нічого — малює рівно
  // так, як віддало меню, а меню йде за sort_order. Тримаємо тут список id
  // у потрібному порядку: null означає «як у базі, не чіпали».
  const [order, setOrder] = useState(null);

  const changed = useMemo(
    () => (data?.drinks ?? []).filter((d) => draft[d.id] !== undefined && Number(draft[d.id]) !== Number(d.price_uah)),
    [data, draft]
  );

  // Рядки в тому порядку, який зараз на екрані адмінки.
  const rows = useMemo(() => {
    const all = data?.drinks ?? [];
    if (!order) return all;
    const by = new Map(all.map((d) => [d.id, d]));
    return order.map((id) => by.get(id)).filter(Boolean);
  }, [data, order]);

  const orderChanged = useMemo(
    () => !!order && order.join() !== (data?.drinks ?? []).map((d) => d.id).join(),
    [data, order]
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

  // Переставити рядок на один угору/вниз. Стрілки, а не перетягування:
  // позицій сімнадцять, миша тут нічого не виграє, а клавіатурою й пальцем
  // кнопки працюють однаково.
  const move = (id, by) => {
    const cur = (order ?? (data?.drinks ?? []).map((d) => d.id)).slice();
    const i = cur.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setOrder(cur);
  };

  const deploy = async () => {
    setBusy(true);
    setNote(null);
    try {
      // Порядок зберігаємо тим самим запитом, що й ціни: він лежить у тій
      // самій таблиці й їде тим самим файлом меню, тож і правилам має
      // підкорятися тим самим — спершу база, потім свідоме викочування.
      // Нумеруємо десятками, як було зроблено до нас: лишається місце
      // вставити позицію руками, не переписуючи всю таблицю.
      const payload = orderChanged
        ? rows.map((d, i) => ({
            id: d.id,
            price_uah: Number(draft[d.id] ?? d.price_uah),
            sort_order: (i + 1) * 10,
          }))
        : changed.map((d) => ({ id: d.id, price_uah: Number(draft[d.id]) }));
      if (payload.length) await api.savePrices(payload);
      const r = await api.deployMenu({ points: targets });
      setNote(`деплоймент №${r.id} у черзі: ${r.points.length} точк(и). ${
        orderChanged ? "Порядок і ціни збережені" : "Ціни збережені"
      } — scheduler бере їх із бази.`);
      setDraft({});
      setOrder(null);
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
            {busy
              ? "Ставимо…"
              : changed.length
                ? `Зберегти й викотити (${changed.length})`
                : orderChanged
                  ? "Зберегти порядок і викотити"
                  : "Викотити меню"}
          </button>
        </div>
      </div>

      {note && <Card className="" style={{ marginBottom: 12 }}><span className="muted">{note}</span></Card>}

      {toggle && (
        <div className="confirm-back" onClick={() => setToggle(null)}>
          <div className="confirm" onClick={(e) => e.stopPropagation()}>
            <b>{toggle.active ? "Сховати з меню?" : "Повернути в меню?"}</b>
            <p>
              {toggle.name} ({toggle.slot}).{" "}
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
            {
              key: "order", title: "№", render: (d) => {
                const i = rows.indexOf(d);
                return (
                  <span className="row" style={{ gap: 4, alignItems: "center" }}>
                    <span className="muted" style={{ width: 18, textAlign: "right" }}>{i + 1}</span>
                    <button className="btn sort-btn" disabled={i === 0} onClick={() => move(d.id, -1)} title="вище">↑</button>
                    <button className="btn sort-btn" disabled={i === rows.length - 1} onClick={() => move(d.id, 1)} title="нижче">↓</button>
                  </span>
                );
              },
            },
            { key: "name", title: "напій", render: (d) => <span><b>{d.name}</b><small>{d.slot} · {d.vol ?? "—"}</small></span> },
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
          rows={rows}
          empty="у базі немає напоїв — залий сіди (bun run seed:apply)"
          foot={orderChanged && (
            <span className="row" style={{ justifyContent: "space-between" }}>
              <span>порядок змінено — поїде на екран із наступним викочуванням</span>
              <button className="btn" style={{ height: 24 }} onClick={() => setOrder(null)}>повернути як було</button>
            </span>
          )}
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
