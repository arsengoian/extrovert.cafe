// Гардероб кавенятка: примірочна на п'ять слотів і подарунок зібраного
// комплекту (economy §3.4).
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

const SLOTS = economy.set.slots;                 // head, body, pants, feet, acc_1
const TIERS = ["common", "uncommon", "rare", "epic"];
const weakest = (tiers) => TIERS.find((t) => tiers.includes(t)) ?? null;

async function plantOf(id, userId) {
  return one("select * from plants where id = $1 and owner_id = $2", [id, userId]);
}

async function setView(plant) {
  if (!plant.worn_set_id) return { set: null, slots: SLOTS.map((slot) => ({ slot, item: null })) };
  const set = await one("select * from wardrobe_sets where id = $1", [plant.worn_set_id]);
  const rows = await many(
    `select wsi.slot, ui.id as user_item_id, ui.locked, d.code, d.name, d.tier, d.sprite_id, d.collection
       from wardrobe_set_items wsi
       join user_items ui on ui.id = wsi.user_item_id
       join item_defs d on d.id = ui.item_def_id
      where wsi.set_id = $1`,
    [plant.worn_set_id]
  );
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  return { set, slots: SLOTS.map((slot) => ({ slot, item: bySlot.get(slot) ?? null })) };
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

    const { set, slots } = await setView(plant);

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
      [user.id, plant.worn_set_id]
    );

    // Раніше подаровані комплекти цього кавенятка — їх можна вдягнути назад.
    const ready = await many(
      `select ws.id, ws.tier, ws.beans_awarded, ws.gifted_at
         from wardrobe_sets ws
        where ws.plant_id = $1 and ws.gifted
        order by ws.gifted_at desc`,
      [plant.id]
    );

    const filled = slots.filter((s) => s.item).length;
    const tier = set?.tier ?? null;
    return {
      plant: { id: plant.id, name: plant.name, growth_stage: plant.growth_stage },
      set: set ? { id: set.id, tier: set.tier, complete: set.complete, gifted: set.gifted, beans_awarded: set.beans_awarded } : null,
      slots,
      filled,
      total: SLOTS.length,
      available,
      ready,
      gift: {
        beans: tier ? economy.set.beans_by_tier[tier] : null,
        tier,
        // Найслабший предмет називаємо поіменно — так видно, що саме тягне
        // комплект донизу.
        weakest_item: slots.find((s) => s.item?.tier === tier)?.item?.name ?? null,
        can: Boolean(set && set.complete && !set.gifted),
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

      let setId = plant.worn_set_id;
      if (setId) {
        const { rows } = await client.query("select gifted from wardrobe_sets where id = $1", [setId]);
        // Подарований комплект не редагується: почати міняти слоти —
        // означає збирати НОВИЙ комплект, а старий лишається як є.
        if (rows[0]?.gifted) setId = null;
      }
      if (!setId) {
        const { rows } = await client.query(
          "insert into wardrobe_sets (plant_id) values ($1) returning id", [plant.id]
        );
        setId = rows[0].id;
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
        if (item.set_id && item.set_id !== setId) fail(409, "item_in_set");

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

  // «Зняти комплект»: незібраний розбираємо, подарований лишаємо цілим —
  // він уже замкнений і колись може повернутись на кавенятко.
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

      const { rows: sets } = await client.query("select * from wardrobe_sets where id = $1", [plant.worn_set_id]);
      await client.query("update plants set worn_set_id = null where id = $1", [plant.id]);

      if (!sets[0]?.gifted) {
        await client.query(
          "update user_items set set_id = null where id in (select user_item_id from wardrobe_set_items where set_id = $1)",
          [sets[0].id]
        );
        await client.query("delete from wardrobe_set_items where set_id = $1", [sets[0].id]);
        await client.query("delete from wardrobe_sets where id = $1", [sets[0].id]);
        return { ok: true, disbanded: true };
      }
      return { ok: true, disbanded: false };
    });
  });

  // Вдягнути назад раніше подарований комплект.
  app.post("/me/plants/:id/wardrobe/wear", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const setId = Number(req.body?.set_id);
    const plant = await plantOf(req.params.id, user.id);
    if (!plant) fail(404, "no_such_plant");
    const set = await one("select * from wardrobe_sets where id = $1 and plant_id = $2", [setId, plant.id]);
    if (!set) fail(404, "no_such_set");

    await tx(async (client) => {
      // Поточний незібраний комплект при цьому розбирається: предмети з
      // нього не мають зависати замкненими в нікуди.
      if (plant.worn_set_id && plant.worn_set_id !== setId) {
        const { rows } = await client.query("select gifted from wardrobe_sets where id = $1", [plant.worn_set_id]);
        if (!rows[0]?.gifted) {
          await client.query(
            "update user_items set set_id = null where id in (select user_item_id from wardrobe_set_items where set_id = $1)",
            [plant.worn_set_id]
          );
          await client.query("delete from wardrobe_set_items where set_id = $1", [plant.worn_set_id]);
          await client.query("delete from wardrobe_sets where id = $1", [plant.worn_set_id]);
        }
      }
      await client.query("update plants set worn_set_id = $2 where id = $1", [plant.id, setId]);
    });
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
      if (!plant.worn_set_id) fail(409, "no_set");

      const { rows: sets } = await client.query(
        "select * from wardrobe_sets where id = $1 for update", [plant.worn_set_id]
      );
      const set = sets[0];
      if (set.gifted) fail(409, "already_gifted");

      const state = await refresh(client, set.id);
      if (!state.complete) fail(409, "incomplete");

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

      await notifyPlant(user.id, `Дякую за комплект! Тримай ${beansWord(beans)} — заслужено.`, { client });
      return { ok: true, beans, tier: state.tier };
    });
  });
}
