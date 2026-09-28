// Знижка в кав'ярні на точці: черга, кінець за часом або першим чеком,
// повернення зерен, якщо знижене меню не доїхало (власник, 28.09.2026;
// gamification_economy.md §6, «Знижка в кав'ярні — як працює»).
//
// Кожна знижка — рядок point_discounts: queued → active → done (або
// refunded). Деплойменти цін — лише наслідок переходів:
//   * знижка стала активною — деплоймент зі зниженими цінами й відліком до
//     ends_at (payload.discount, lib/menu.js);
//   * скінчилась, а в черзі нікого — звичайні ціни;
//   * скінчилась, а в черзі наступна — одразу її знижене меню, без
//     проміжного «звичайного».
// Кіоск і без деплою повернення сам знімає знижку, коли ends_at мине
// (raspberry/kiosk, menu_expire_discount); деплой потрібен, щоб і меню в
// бакеті, і Checkbox з автоматом повернулись до звичайних цін.
//
// Усі функції — всередині транзакції виклику. Переходи на одній точці
// серіалізує advisory-lock: дві купівлі в ту саму мить не зроблять дві
// активні (а якщо й спробують — не дасть унікальний індекс).
import { enqueue } from "./outbox.js";

const lockPoint = (client, pointId) =>
  client.query("select pg_advisory_xact_lock(hashtext($1))", [`discount:${pointId}`]);

async function deploy(client, pointId, payload) {
  const { rows } = await client.query(
    "insert into menu_deployments (payload, status) values ($1, 'queued') returning id",
    [JSON.stringify(payload)]
  );
  await client.query(
    "insert into menu_deployment_targets (deployment_id, kind, point_id) values ($1, 'r2', $2)",
    [rows[0].id, pointId]
  );
  return rows[0].id;
}

// Наступна в черзі стає активною, якщо активної зараз немає. Повертає її
// (або null — черга порожня чи вже хтось активний).
export async function activateNext(client, pointId) {
  await lockPoint(client, pointId);
  const { rows: active } = await client.query(
    "select id from point_discounts where point_id = $1 and status = 'active'", [pointId]);
  if (active.length) return null;
  const { rows } = await client.query(
    "select * from point_discounts where point_id = $1 and status = 'queued' order by id limit 1 for update", [pointId]);
  const next = rows[0];
  if (!next) return null;
  const endsAt = new Date(Date.now() + next.window_s * 1000);
  const deploymentId = await deploy(client, pointId, {
    reason: "pos_discount",
    discount: { uah: next.uah, until: endsAt.toISOString() },
    point_discount_id: Number(next.id),
  });
  await client.query(
    "update point_discounts set status = 'active', started_at = now(), ends_at = $2, deployment_id = $3 where id = $1",
    [next.id, endsAt, deploymentId]
  );
  return { ...next, ends_at: endsAt, deployment_id: deploymentId };
}

// Поставити знижку в чергу точки й, якщо точка вільна, одразу ввімкнути.
// Повертає рядок і скільки знижок перед ним (0 — уже діє).
export async function queueDiscount(client, pointId, { uah, seconds, userId = null, ledgerEntryId = null }) {
  const { rows } = await client.query(
    `insert into point_discounts (point_id, user_id, ledger_entry_id, uah, window_s)
     values ($1, $2, $3, $4, $5) returning id`,
    [pointId, userId, ledgerEntryId, uah, seconds]
  );
  const id = rows[0].id;
  await activateNext(client, pointId);
  const { rows: mine } = await client.query("select status, ends_at from point_discounts where id = $1", [id]);
  const { rows: ahead } = await client.query(
    `select count(*)::int as n from point_discounts
      where point_id = $1 and id < $2 and status in ('queued', 'active')`,
    [pointId, id]
  );
  return { id: Number(id), status: mine[0].status, ends_at: mine[0].ends_at, ahead: ahead[0].n };
}

// Скінчити активну знижку точки (reason: time | receipt | failed). after —
// для чека: знижку закінчує лише чек, пробитий уже під час неї, а не той,
// що доїхав опитуванням із запізненням.
export async function endActive(client, pointId, reason, { after = null } = {}) {
  await lockPoint(client, pointId);
  const { rows } = await client.query(
    `select * from point_discounts where point_id = $1 and status = 'active'
       and ($2::timestamptz is null or started_at <= $2) for update`,
    [pointId, after]
  );
  const active = rows[0];
  if (!active) return null;
  await client.query(
    "update point_discounts set status = 'done', ended_at = now(), ended_reason = $2 where id = $1",
    [active.id, reason]
  );
  const next = await activateNext(client, pointId);
  if (!next) await deploy(client, pointId, { reason: "prices", after_discount: Number(active.id) });
  return active;
}

// Знижки, чий час вийшов, — скінчити (робота scheduler, раз на кілька секунд).
export async function expireDiscounts(client) {
  const { rows } = await client.query(
    "select point_id from point_discounts where status = 'active' and ends_at <= now()");
  for (const r of rows) await endActive(client, r.point_id, "time");
  return rows.length;
}

// Знижене меню не доїхало: ціль r2 його деплою failed — заливка впала або
// кіоск не підтвердив, що показує (lib/deployments.js). Зерна — назад,
// гравцю — подія user:<id> (застосунок покаже попап), активна — кінчається.
export async function refundFailed(client) {
  const { rows } = await client.query(
    `select pd.*, p.name as point_name
       from point_discounts pd
       join points p on p.id = pd.point_id
       join menu_deployment_targets t on t.deployment_id = pd.deployment_id and t.kind = 'r2'
      where pd.status in ('active', 'done') and t.status = 'failed'`
  );
  for (const d of rows) {
    if (d.status === "active") await endActive(client, d.point_id, "failed");
    await client.query(
      "update point_discounts set status = 'refunded', ended_reason = 'failed', ended_at = coalesce(ended_at, now()) where id = $1",
      [d.id]
    );
    if (!d.user_id || !d.ledger_entry_id) continue;
    const { rows: spent } = await client.query(
      "select -delta_beans as beans from ledger_entries where id = $1", [d.ledger_entry_id]);
    const beans = spent[0]?.beans ?? 0;
    if (beans <= 0) continue;
    await client.query("update users set beans = beans + $2 where id = $1", [d.user_id, beans]);
    await client.query(
      "insert into ledger_entries (user_id, delta_beans, reason, meta) values ($1, $2, 'pos_discount', $3)",
      [d.user_id, beans, { refund: true, point_discount_id: Number(d.id) }]
    );
    await enqueue(client, `user:${d.user_id}`, "discount_refunded", {
      point_discount_id: Number(d.id), beans, point_name: d.point_name,
    });
  }
  return rows.length;
}
