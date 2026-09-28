// Гардероб кавенятка: подаровані комплекти, примірочна на п'ять слотів і
// подарунок зібраного в ній комплекту (economy §3.4).
//
// Модель (власник, 27.09.2026 — до того це була помилка дизайну): у
// кавенятка може бути скільки завгодно подарованих комплектів, і будь-який
// із них можна вдягнути. Вдягнене — або один із них, або речі з
// примірочної (plants.worn_set_id вказує на той чи інший комплект).
// Примірочна — окремий незібраний комплект (wardrobe_sets, gifted = false,
// не більше одного на кавенятко), і існує вона, щоб зібрати НОВИЙ комплект:
// вдягнути подарований комплект її не розбирає, а дарується саме вона.
// Раніше примірочна й «вдягнене» були одним і тим самим: вдягнув
// подарований — і зібране в примірочній розліталось назад на склад.
//
// Головне правило звідти ж: зерна дає НЕ заповнення слотів, а явний
// «Подарувати». До цього моменту комплект вільно розбирається, після —
// усі п'ять предметів замкнені назавжди (інакше ті самі речі можна було б
// перекомбіновувати й доїти зерна).
//
// Рідкість комплекту — за найслабшим предметом, а не середня: так гравцеві
// є сенс апгрейдити кожен слот окремо.
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { beansWord, notifyPlant } from "../notify.js";
import { growthState } from "./planting.js";

const SLOTS = economy.set.slots;                 // head, body, pants, feet, acc_1
const TIERS = ["common", "uncommon", "rare", "epic"];
const weakest = (tiers) => TIERS.find((t) => tiers.includes(t)) ?? null;

async function plantOf(id, userId) {
  return one("select * from plants where id = $1 and owner_id = $2", [id, userId]);
}

// Примірочна кавенятка — його незібраний комплект. Якщо з давніх часів
// таких кілька, беремо найновіший.
const FITTING = "select * from wardrobe_sets where plant_id = $1 and not gifted order by id desc limit 1";

async function slotsOf(setId) {
  if (!setId) return SLOTS.map((slot) => ({ slot, item: null }));
  const rows = await many(
    `select wsi.slot, ui.id as user_item_id, ui.locked, d.code, d.name, d.tier, d.sprite_id, d.collection
       from wardrobe_set_items wsi
       join user_items ui on ui.id = wsi.user_item_id
       join item_defs d on d.id = ui.item_def_id
      where wsi.set_id = $1`,
    [setId]
  );
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  return SLOTS.map((slot) => ({ slot, item: bySlot.get(slot) ?? null }));
}

// Примірочна під замком рядка кавенятка; якщо її ще немає — створюємо.
async function fittingFor(client, plantId) {
  const { rows } = await client.query(`${FITTING} for update`, [plantId]);
  if (rows[0]) return rows[0].id;
  const { rows: made } = await client.query("insert into wardrobe_sets (plant_id) values ($1) returning id", [plantId]);
  return made[0].id;
}

// Перерахунок після кожної зміни слота: тір і «чи повний» — похідні дані,
// тримати їх узгодженими руками означає рано чи пізно розійтись.
async function refresh(client, setId) {
  const { rows } = await client.query(
    `select d.tier from wardrobe_set_items wsi
       join user_items ui on ui.id = wsi.user_item_id
       join item_defs d on d.id = ui.item_def_id
      where wsi.set_id = $1`,
    [setId]
  );
  const complete = rows.length === SLOTS.length;
  const tier = rows.length ? weakest(rows.map((r) => r.tier)) : null;
  await client.query("update wardrobe_sets set complete = $2, tier = $3 where id = $1", [setId, complete, tier]);
  return { complete, tier };
}

export default async function routes(app) {
  app.get("/me/plants/:id/wardrobe", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const plant = await plantOf(req.params.id, user.id);
    if (!plant) fail(404, "no_such_plant");

    const set = await one(FITTING, [plant.id]);
    const slots = await slotsOf(set?.id);

    // Подаровані комплекти з їхніми речами — смуга «Комплекти» в гардеробі.
    const sets = await many(
      `select ws.id, ws.tier, ws.beans_awarded, ws.gifted_at,
              coalesce((select json_agg(json_build_object('slot', wsi.slot, 'name', d.name, 'tier', d.tier, 'sprite_id', d.sprite_id))
                          from wardrobe_set_items wsi
                          join user_items ui on ui.id = wsi.user_item_id
                          join item_defs d on d.id = ui.item_def_id
                         where wsi.set_id = ws.id), '[]') as items
         from wardrobe_sets ws
        where ws.plant_id = $1 and ws.gifted
        order by ws.gifted_at`,
      [plant.id]
    );

    // Що вдягнене зараз: примірочна, один із подарованих чи нічого.
    const wornGifted = sets.find((g) => String(g.id) === String(plant.worn_set_id)) ?? null;
    const wornKind = !plant.worn_set_id ? null : wornGifted ? "gifted" : String(plant.worn_set_id) === String(set?.id) ? "fitting" : null;
    const wornSlots = wornKind === "gifted"
      ? SLOTS.map((slot) => ({ slot, item: wornGifted.items.find((i) => i.slot === slot) ?? null }))
      : wornKind === "fitting" ? slots : SLOTS.map((slot) => ({ slot, item: null }));
    const wornFilled = wornSlots.filter((w) => w.item).length;

    // Що можна вдягнути: своє, не замкнене чужим комплектом і не виставлене
    // на продаж. Дублікати теж годяться — вони різні рядки user_items.
    const available = await many(
      `select ui.id as user_item_id, d.slot, d.code, d.name, d.tier, d.sprite_id, d.collection
         from user_items ui
         join item_defs d on d.id = ui.item_def_id
        where ui.user_id = $1
          and ui.listing_id is null
          and not ui.locked
          and (ui.set_id is null or ui.set_id = $2)
        order by d.slot, d.tier desc, d.name`,
      [user.id, set?.id ?? null]
    );

    const filled = slots.filter((s) => s.item).length;
    const tier = set?.tier ?? null;
    // Доросле кавенятко чи ще росте: від цього залежить не тільки відповідь
    // на «Подарувати», а й те, що написано під кнопкою. Краще сказати
    // заздалегідь, ніж дати натиснути й відмовити.
    const grown = growthState(plant).done;
    return {
      plant: { id: plant.id, name: plant.name, growth_stage: plant.growth_stage },
      worn: {
        kind: wornKind,
        set_id: wornKind ? plant.worn_set_id : null,
        slots: wornSlots,
        filled: wornFilled,
        complete: wornFilled === SLOTS.length,
      },
      // set / slots / filled — примірочна.
      set: set ? { id: set.id, tier: set.tier, complete: set.complete, gifted: false } : null,
      slots,
      filled,
      total: SLOTS.length,
      available,
      sets: sets.map((g) => ({ ...g, worn: g.id === wornGifted?.id })),
      gift: {
        beans: tier ? economy.set.beans_by_tier[tier] : null,
        tier,
        // Найслабший предмет називаємо поіменно — так видно, що саме тягне
        // комплект донизу.
        weakest_item: slots.find((s) => s.item?.tier === tier)?.item?.name ?? null,
        can: Boolean(set && set.complete && grown),
        grown,
        missing: SLOTS.length - filled,
      },
    };
  });

  // Вдягнути предмет у слот або звільнити слот (user_item_id = null).
  app.put("/me/plants/:id/wardrobe/:slot", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const slot = String(req.params.slot);
    if (!SLOTS.includes(slot)) fail(400, "bad_slot");
    const itemId = req.body?.user_item_id ?? null;

    return tx(async (client) => {
      const { rows: plants } = await client.query(
        "select * from plants where id = $1 and owner_id = $2 for update",
        [req.params.id, user.id]
      );
      const plant = plants[0];
      if (!plant) fail(404, "no_such_plant");
      if (plant.listing_id) fail(409, "on_sale");

      // Слоти — завжди примірочна: подарований комплект не редагується. А
      // що міряєш, те й вдягнене — інакше річ «вдягнули», а на кущі її немає.
      const setId = await fittingFor(client, plant.id);
      if (String(plant.worn_set_id) !== String(setId)) {
        await client.query("update plants set worn_set_id = $2 where id = $1", [plant.id, setId]);
      }

      // Звільняємо слот у будь-якому разі: і при знятті, і при заміні.
      const { rows: old } = await client.query(
        "delete from wardrobe_set_items where set_id = $1 and slot = $2 returning user_item_id",
        [setId, slot]
      );
      if (old.length) await client.query("update user_items set set_id = null where id = $1", [old[0].user_item_id]);

      if (itemId !== null) {
        const { rows: items } = await client.query(
          `select ui.id, ui.locked, ui.set_id, ui.listing_id, d.slot
             from user_items ui join item_defs d on d.id = ui.item_def_id
            where ui.id = $1 and ui.user_id = $2 for update`,
          [itemId, user.id]
        );
        const item = items[0];
        if (!item) fail(404, "no_such_item");
        if (item.slot !== slot) fail(400, "wrong_slot", { slot: item.slot });
        if (item.locked) fail(409, "item_locked");
        if (item.listing_id) fail(409, "item_on_market");
        // Річ у примірочній іншого кавенятка — «Перевдягнути»: забираємо її
        // звідти й кладемо сюди (власник, 28.09.2026). Подарований комплект
        // сюди не потрапляє — його речі замкнені (locked) вище.
        if (item.set_id && String(item.set_id) !== String(setId)) {
          const { rows: from } = await client.query("select gifted from wardrobe_sets where id = $1", [item.set_id]);
          if (from[0]?.gifted) fail(409, "item_in_set");
          await client.query("delete from wardrobe_set_items where user_item_id = $1", [itemId]);
          await client.query("update user_items set set_id = null where id = $1", [itemId]);
          await refresh(client, item.set_id);
        }

        await client.query(
          "insert into wardrobe_set_items (set_id, slot, user_item_id) values ($1, $2, $3)",
          [setId, slot, itemId]
        );
        await client.query("update user_items set set_id = $2 where id = $1", [itemId, setId]);
      }

      const state = await refresh(client, setId);
      return { ok: true, set_id: setId, ...state };
    });
  });

  // «Зняти комплект» / «Зняти все»: кавенятко стоїть без одягу, але нічого
  // не розбирається. Подарований комплект лишається в смузі «Комплекти», а
  // примірочна — робоче місце нового комплекту: зібране в ній чекає, і
  // «приміряти» вдягає його назад. Річ зі слота на склад повертає тап по
  // самому слоту. Раніше «Зняти все» розсипало примірочну на склад.
  app.delete("/me/plants/:id/wardrobe", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return tx(async (client) => {
      const { rows: plants } = await client.query(
        "select * from plants where id = $1 and owner_id = $2 for update", [req.params.id, user.id]
      );
      const plant = plants[0];
      if (!plant) fail(404, "no_such_plant");
      if (!plant.worn_set_id) return { ok: true, disbanded: false };

      await client.query("update plants set worn_set_id = null where id = $1", [plant.id]);
      return { ok: true, disbanded: false };
    });
  });

  // Вдягнути будь-який комплект цього кавенятка — подарований або
  // примірочну. Примірочна при цьому НЕ розбирається: зібране в ній чекає,
  // поки його довершать і подарують.
  app.post("/me/plants/:id/wardrobe/wear", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const setId = Number(req.body?.set_id);
    const plant = await plantOf(req.params.id, user.id);
    if (!plant) fail(404, "no_such_plant");
    const set = await one("select * from wardrobe_sets where id = $1 and plant_id = $2", [setId, plant.id]);
    if (!set) fail(404, "no_such_set");

    if (plant.listing_id) fail(409, "on_sale");
    await one("update plants set worn_set_id = $2 where id = $1 returning id", [plant.id, setId]);
    return { ok: true };
  });

  // Подарунок: зерна за тір найслабшого предмета, замикання всіх п'яти.
  app.post("/me/plants/:id/wardrobe/gift", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return tx(async (client) => {
      const { rows: plants } = await client.query(
        "select * from plants where id = $1 and owner_id = $2 for update", [req.params.id, user.id]
      );
      const plant = plants[0];
      if (!plant) fail(404, "no_such_plant");

      // Дарується примірочна, а не те, що вдягнене: кавенятко може стояти в
      // подарованому комплекті, поки в примірочній збирається новий.
      const { rows: sets } = await client.query(`${FITTING} for update`, [plant.id]);
      const set = sets[0];
      if (!set) fail(409, "no_set");

      const state = await refresh(client, set.id);
      if (!state.complete) fail(409, "incomplete");
      // Дарують ДОРОСЛОМУ кавенятку: одяг — нагорода за вирощене, а не за
      // намір. Перевірки не було взагалі, тож комплект замикався назавжди
      // й на паростку (26.09.2026, власник). growthState().done означає
      // «далі рости нікуди» — остання стадія з дозрілими плодами.
      if (!growthState(plant).done) fail(409, "not_grown");

      const beans = economy.set.beans_by_tier[state.tier] ?? 0;
      await client.query(
        "update wardrobe_sets set gifted = true, gifted_at = now(), beans_awarded = $2 where id = $1",
        [set.id, beans]
      );
      await client.query(
        "update user_items set locked = true where id in (select user_item_id from wardrobe_set_items where set_id = $1)",
        [set.id]
      );
      await client.query("update users set beans = beans + $2 where id = $1", [user.id, beans]);
      await client.query(
        "update plants set lifetime_beans_gifted = lifetime_beans_gifted + $2 where id = $1",
        [plant.id, beans]
      );
      await client.query(
        `insert into ledger_entries (user_id, delta_beans, reason, meta)
         values ($1, $2, 'wardrobe_set', $3)`,
        [user.id, beans, { plant_id: plant.id, set_id: set.id, tier: state.tier }]
      );

      // Саме від цього куща: подяка за одяг від сусіднього кавенятка —
      // дрібниця, яку видно одразу (24.09.2026).
      await notifyPlant(user.id, `Дякую за комплект! Тримай ${beansWord(beans)} — заслужено.`, { client, plantId: plant.id });
      return { ok: true, beans, tier: state.tier };
    });
  });
}
