// Викочування меню на точки: черга menu_deployments → menu.json у R2.
//
// Раніше це робив скрипт із машини розробника (pos/scripts/push-prices.mjs).
// Він же й показав, чому так не можна: 20.09.2026 запуск із робочої машини
// поклав меню в живий бакет. Тепер меню котить сервіс, з тими самими
// ключами, що й решта прода, а людина лише ставить деплоймент у чергу
// (POST /admin/menu/deployments) — і видно, хто, коли й що саме.
//
// Склад menu.json рахує @extrovert/lib/menu.js: те саме меню віддає кіоску
// роут api, тож формат має бути один на двох.
import { buildMenu } from "@extrovert/lib/menu.js";
import { put } from "@extrovert/lib/r2.js";
import { enqueue } from "@extrovert/lib/outbox.js";

// Клієнта беремо один на прохід і віддаємо його у finally. Черга
// деплойментів майже завжди порожня, тож ранній вихід «нема чого котити»
// трапляється шість разів на хвилину — і 22.09.2026 саме він з'їв пул:
// release() стояв лише на щасливому шляху. За півтори хвилини вільних
// клієнтів не лишилось, і весь scheduler завис на pool.connect() без
// жодного рядка в лозі — бонуси лежали в outbox неопубліковані, а QR на
// кіоску не з'являвся.
export async function deployMenus({ pool, log }) {
  const client = await pool.connect();
  try {
    return await deployNext(client, log);
  } finally {
    client.release();
  }
}

async function deployNext(client, log) {
  let deployment;
  try {
    await client.query("begin");
    // skip locked: дві копії scheduler не візьмуть той самий деплоймент,
    // а зайнятий рядок не блокує чергу.
    const { rows } = await client.query(
      `select id, payload from menu_deployments
        where status = 'queued' and (scheduled_at is null or scheduled_at <= now())
        order by id
        limit 1
        for update skip locked`
    );
    deployment = rows[0];
    if (!deployment) { await client.query("commit"); return null; }
    await client.query("update menu_deployments set status = 'deploying' where id = $1", [deployment.id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  }

  // Меню тепер різне на різних машинах: коди позицій збираються з літери
  // точки (points.machine_letter), а решта вмісту спільна. Тому будуємо
  // його всередині циклу по цілях, а не один раз на деплоймент.
  const menuFor = async (letter) => {
    const menu = await buildMenu(client, letter).catch(async (e) => {
      await client.query(
        "update menu_deployments set status = 'failed', finished_at = now() where id = $1",
        [deployment.id]
      );
      throw e;
    });
    const body = Buffer.from(JSON.stringify(menu, null, 2) + "\n");
    return { menu, body };
  };

  const { rows: targets } = await client.query(
    `select t.id, t.point_id, t.kind, p.machine_letter
       from menu_deployment_targets t
       join points p on p.id = t.point_id
      where t.deployment_id = $1 and t.status = 'queued'`,
    [deployment.id]
  );

  let done = 0, failed = 0;
  for (const t of targets) {
    if (t.kind !== "r2") continue;          // checkbox і jetinno — окремі роботи
    try {
      const { menu, body } = await menuFor(t.machine_letter);
      // 30 секунд кешу — щоб зміна доїхала на екран навіть тоді, коли подія
      // menu.deployed до кіоска не дійшла (docs/services.md §4).
      await put({
        purpose: "pos",
        key: `points/${t.point_id}/menu.json`,
        body,
        contentType: "application/json",
        cacheControl: "public, max-age=30",
      });
      await client.query(
        "update menu_deployment_targets set status = 'done', done_at = now(), error = null where id = $1",
        [t.id]
      );
      // Кіоск і так перечитує меню раз на хвилину; подія лише прибирає цю
      // хвилину очікування (і дає acked_at, коли кіоск підтвердить).
      await enqueue(client, `point:${t.point_id}`, "menu.deployed", {
        deployment_id: Number(deployment.id),
        drinks: menu.drinks.length,
      });
      done++;
    } catch (e) {
      failed++;
      await client.query(
        "update menu_deployment_targets set status = 'failed', error = $2 where id = $1",
        [t.id, String(e.message ?? e).slice(0, 500)]
      );
      log?.error(`меню на ${t.point_id} не поїхало`, e);
    }
  }

  const status = failed === 0 ? "done" : done === 0 ? "failed" : "partial";
  await client.query(
    "update menu_deployments set status = $2, finished_at = now() where id = $1",
    [deployment.id, status]
  );

  return { done: `меню #${deployment.id}: ${done} точок, ${failed} помилок`, extra: { status } };
}
