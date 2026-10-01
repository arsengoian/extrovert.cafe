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
import { catalogClient, uahToKop } from "@extrovert/lib/checkbox-catalog.js";

// Ціль `checkbox`: ціни меню точки → каталог Checkbox (lib/checkbox-catalog.js).
// Кожна ціна після запису перечитується, і ціль done, лише коли в каталозі
// справді вони (власник, 01.10.2026: «деплоймент перевіряє успішне
// встановлення цін у Checkbox?» — досі ця ціль існувала лише в схемі).
//
// Що вважаємо провалом: товар із кодом трапляється двічі, ціна різниться
// в десятки разів (так виглядають сплутані гривні й копійки), запис не
// пройшов або разом із ціною змінилось щось іще. Після першого ж провалу
// запису зупиняємось — якщо PUT поводиться не так, як ми думаємо, решта
// каталогу вціліє. Напою, якого в каталозі немає (бонусні позиції, поки
// їх не заведено), каса й не продасть — це не провал, але в поясненні цілі
// його видно.
async function deployCheckbox(client, t, menu, log) {
  const finish = async (status, error) => {
    await client.query(
      `update menu_deployment_targets set status = $2, error = $3,
              done_at = case when $2 = 'done' then now() else done_at end
        where id = $1`,
      [t.id, status, error ? String(error).slice(0, 500) : null]
    );
    return status !== "failed";
  };
  const cb = catalogClient();
  if (!cb.prod) return finish("skipped", "локально каталог Checkbox не пишемо: він спільний із бойовою касою");
  if (!cb.configured) return finish("failed", "немає CHECKBOX_LOGIN / CHECKBOX_PASSWORD");

  try {
    const catalog = await cb.catalog();
    const missing = [], problems = [];
    let written = 0;
    for (const d of menu.drinks) {
      const code = d.system_code;
      if (!code) continue;
      const good = catalog.get(code);
      if (good === undefined) { missing.push(`${d.name} (${code})`); continue; }
      if (good === null) { problems.push(`${code}: кілька товарів із цим кодом`); continue; }
      const kop = uahToKop(d.price);
      const now = good.price;
      if (now === kop) continue;
      // Знижка опускає ціну й до 1 ₴ (35 → 1, у 35 разів) — це нормально;
      // сплутані гривні з копійками — це рівно ×100.
      const ratio = now > 0 ? kop / now : 1;
      if (ratio >= 50 || ratio <= 1 / 50) { problems.push(`${d.name} (${code}): ${now} → ${kop} коп. — схоже на сплутані гривні й копійки`); continue; }
      const err = await cb.setPrice(good, kop);
      if (err) { problems.push(`${d.name} (${code}): ${err}`); break; }
      written++;
    }
    const note = [...problems, missing.length ? `нема в каталозі: ${missing.join(", ")}` : ""].filter(Boolean).join("; ");
    log?.info(`Checkbox для ${t.point_id}: записано ${written}${note ? `; ${note}` : ""}`);
    return finish(problems.length ? "failed" : "done", note || null);
  } catch (e) {
    log?.error(`ціни в Checkbox для ${t.point_id} не записались`, e);
    return finish("failed", e.message ?? e);
  }
}

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
    // payload.discount — знижка на точці (backend/api/src/discount.js).
    const menu = await buildMenu(client, letter, deployment.payload ?? {}).catch(async (e) => {
      await client.query(
        "update menu_deployments set status = 'failed', finished_at = now() where id = $1",
        [deployment.id]
      );
      throw e;
    });
    // Номер деплою — у самому меню: кіоск підтверджує його (menu/ack) і
    // тоді, коли нове меню приїхало звичайним опитуванням, а не подією, —
    // точка, яка була офлайн під час викоту, не лишається «не на екрані»
    // назавжди (lib/deployments.js).
    menu.deployment = Number(deployment.id);
    const body = Buffer.from(JSON.stringify(menu, null, 2) + "\n");
    return { menu, body };
  };

  // Спершу бакет (екран кіоска), потім Checkbox: на запис кожної ціни в
  // каталог іде три запити, і екран не має на них чекати.
  const { rows: targets } = await client.query(
    `select t.id, t.point_id, t.kind, p.machine_letter
       from menu_deployment_targets t
       join points p on p.id = t.point_id
      where t.deployment_id = $1 and t.status = 'queued'
      order by t.kind = 'r2' desc, t.id`,
    [deployment.id]
  );

  let done = 0, failed = 0;
  for (const t of targets) {
    if (t.kind === "checkbox") {
      const ok = await deployCheckbox(client, t, (await menuFor(t.machine_letter)).menu, log);
      if (ok) done++; else failed++;
      continue;
    }
    if (t.kind !== "r2") continue;          // jetinno — коли буде доступ до порталу
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
