// Знижка на точці — не код, а два деплойменти цін для неї
// (gamification_economy.md §6, «Знижка в кав'ярні — як працює»): спершу меню з
// ціною, нижчою на uah, а коли вікно закінчиться — звичайне. Черга
// menu_deployments котить деплойменти по одному в порядку id і не раніше
// scheduled_at, тож порядок «знижка, потім повернення» дає сама.
//
// Кінець вікна — абсолютний час (until), а не «N секунд після викоту»:
// кіоск рахує відлік від нього ж, і обидва деплойменти, і плашка на
// екрані дивляться на одне число. Повернення заплановане на той самий
// until; кіоск і без нього сам поверне звичайні ціни, коли час вийде
// (raspberry/kiosk, menu_expire_discount).
//
// Поки що ціль лише r2 (меню на кіоску): цілей checkbox і jetinno ще
// немає, а без них автомат пробиває звичайну ціну. Гравцям знижка однаково
// продається з 28.09.2026 (власник) — перед релізом її вимкнуть
// (economy.json, available: false), якщо ціна не доїжджатиме до автомата.
// Кличуть: купівля (routes/purchases.js) і тестовий запуск в адмінці.
export async function queueDiscount(client, pointId, { uah, seconds, createdBy = null, meta = {} }) {
  const until = new Date(Date.now() + seconds * 1000);
  const insert = async (payload, scheduledAt) => {
    const { rows } = await client.query(
      `insert into menu_deployments (payload, status, created_by, scheduled_at)
       values ($1, 'queued', $2, $3) returning id`,
      [JSON.stringify(payload), createdBy, scheduledAt]
    );
    await client.query(
      "insert into menu_deployment_targets (deployment_id, kind, point_id) values ($1, 'r2', $2)",
      [rows[0].id, pointId]
    );
    return rows[0].id;
  };
  const lowered = await insert({ reason: "pos_discount", discount: { uah, until: until.toISOString() }, ...meta }, null);
  const restored = await insert({ reason: "prices", after_discount: lowered }, until);
  return { until, deployments: [lowered, restored] };
}
