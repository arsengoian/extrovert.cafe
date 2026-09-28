// Підтвердження меню кіоском (acked_at) і що буває, коли його немає.
//
// Ціль r2 стає «done», щойно menu.json ліг у бакет, — але це ще не «на
// екрані». Кіоск підтверджує сам (POST /points/:id/menu/ack), і якщо за
// ACK_DEADLINE_MIN хвилин підтвердження немає, overseer позначає ціль
// «failed» з поясненням UNACKED і пише в Telegram (власник, 28.09.2026).
//
// Нічого не відкочується: меню лишається в бакеті, кіоск і далі перечитує
// його щохвилини, а коли підтвердить — хоч за годину, коли точка оживе, —
// api повертає ціль у «done» (points.js, menu/ack).
export const ACK_DEADLINE_MIN = 3;
export const UNACKED = "кіоск не підтвердив, що показує це меню";
// Раніше за цю мить кіоск підтвердження не слав узагалі, тож старі цілі без
// acked_at — не поломка, а просто історія. Перевіряємо лише новіші й не
// старші за добу: інакше перший же обхід переписав би всю історію в failed.
const ACK_SINCE = "2026-09-28T04:00:00Z";   // реліз, з яким кіоск підтверджує й за опитуванням

// Статус деплойменту — з його цілей: усі done — done, жодної — failed,
// інакше partial. Деплойменти, що ще в черзі чи котяться, не чіпаємо.
export async function recountDeployments(client, ids) {
  if (!ids.length) return;
  await client.query(
    `update menu_deployments d
        set status = case when s.done = s.total then 'done' when s.done = 0 then 'failed' else 'partial' end
       from (select deployment_id,
                    count(*) filter (where status = 'done') as done,
                    count(*) as total
               from menu_deployment_targets
              where deployment_id = any($1::bigint[])
              group by deployment_id) s
      where d.id = s.deployment_id and d.status in ('done', 'partial', 'failed')`,
    [ids]
  );
}

// Прострочені підтвердження → failed. Повертає, що позначили.
export async function markUnacked(client, minutes = ACK_DEADLINE_MIN, since = ACK_SINCE) {
  const { rows } = await client.query(
    `update menu_deployment_targets
        set status = 'failed', error = $1
      where kind = 'r2' and status = 'done' and acked_at is null
        and done_at < now() - make_interval(mins => $2)
        and done_at > greatest(now() - interval '1 day', $3::timestamptz)
      returning deployment_id, point_id`,
    [UNACKED, minutes, since]
  );
  await recountDeployments(client, [...new Set(rows.map((r) => r.deployment_id))]);
  return rows;
}

// Кіоск підтвердив запізно — ціль знову done (лише та, що впала саме через
// відсутність підтвердження, а не через збій заливки).
export async function restoreAcked(client, deploymentId, pointId) {
  const { rows } = await client.query(
    `update menu_deployment_targets set status = 'done', error = null
      where deployment_id = $1 and point_id = $2 and kind = 'r2' and status = 'failed' and error = $3
      returning deployment_id`,
    [deploymentId, pointId, UNACKED]
  );
  await recountDeployments(client, rows.map((r) => r.deployment_id));
  return rows.length > 0;
}
