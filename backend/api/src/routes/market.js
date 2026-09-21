// P2P-маркет: гравці продають одяг і кавенят одне одному.
//
// Покупець не гортає весь маркет — API пропонує йому кілька лотів
// зваженим рандомом: вага = ціна^−k, тож дешевший лот претендує частіше, а
// дорожчий не зникає назовсім (services.md §4). «Найдешевші зверху» не
// підходять: тоді кілька лотів забирали б усі покази назавжди.
//
// Показ — це лот, який API повернув у такій відповіді. Лічильник живе в
// Redis, бо інакше кожне відкриття прев'ю писало б до десяти оновлень у
// гарячі рядки; у Postgres його раз на хвилину переносить scheduler.
import { redisClient } from "@extrovert/lib/redis.js";
import { many, one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { economy } from "../economy.js";
import { notifyPlant } from "../notify.js";

export const IMPRESSIONS_KEY = "market:impressions";

const M = economy.market;
const redis = redisClient({ lazyConnect: true, maxRetriesPerRequest: 2 });
redis.connect().catch(() => {});

// Ціна в монетах — спільна лінійка для ваги: зерна переводимо курсом.
const IN_COINS = `(case when l.price_currency = 'beans' then l.price_amount * ${economy.beans.rate_coins} else l.price_amount end)`;

const clampLimit = (value) => {
  const n = Number(value ?? M.offer_limit_default);
  if (!Number.isFinite(n)) return M.offer_limit_default;
  return Math.max(1, Math.min(M.offer_limit_max, Math.trunc(n)));
};

// Покази пишемо пачкою й не чекаємо на них: маркет не має падати через
// Redis, а втрата хвилини показів нікому не шкодить.
function countImpressions(ids) {
  if (!ids.length) return;
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hincrby(IMPRESSIONS_KEY, String(id), 1);
  pipeline.exec().catch(() => {});
}

async function pendingImpressions(ids) {
  if (!ids.length) return {};
  try {
    const values = await redis.hmget(IMPRESSIONS_KEY, ...ids.map(String));
    return Object.fromEntries(ids.map((id, i) => [id, Number(values[i] ?? 0)]));
  } catch {
    return {};
  }
}

const listingView = (row) => ({
  id: row.id,
  kind: row.kind,
  price: row.price_amount,
  currency: row.price_currency,
  seller: row.seller,
  created_at: row.created_at,
  item: row.item_name ? { name: row.item_name, tier: row.tier, slot: row.slot, sprite_id: row.sprite_id } : null,
  plant: row.plant_name !== undefined && row.kind === "plant"
    ? { name: row.plant_name, growth_stage: row.growth_stage, appearance: row.appearance, full_sets: row.full_sets, worn: row.worn }
    : null,
});

export default async function routes(app) {
  // Правила для екрана «Продати одяг»: комісія, мінімальна ціна й
  // діапазон цін схожих лотів — «Схожі лоти зараз 120-165». Покази тут не
  // рахуються: це не пропозиція покупцю.
  app.get("/market/rules", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const itemCode = String(req.query?.item ?? "");
    const range = itemCode
      ? await one(
          `select min(l.price_amount)::int as min, max(l.price_amount)::int as max, count(*)::int as n
             from market_listings l
             join user_items ui on ui.id = l.user_item_id
             join item_defs d on d.id = ui.item_def_id
            where l.kind = 'item' and d.code = $1 and l.status = 'active'
              and l.price_currency = 'yellow' and l.seller_id <> $2`,
          [itemCode, user.id]
        )
      : null;
    return { commission_pct: M.commission_pct, min_price: M.min_price, similar: range?.n ? range : null };
  });

  // Лоти конкретного предмета — для прев'ю в Магазині.
  app.get("/market/offers", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const itemCode = String(req.query?.item ?? "");
    const limit = clampLimit(req.query?.limit);
    if (!itemCode) fail(400, "item_required");

    const rows = await many(
      `select l.*, u.nickname as seller, d.name as item_name, d.tier, d.slot, d.sprite_id
         from market_listings l
         join user_items ui on ui.id = l.user_item_id
         join item_defs d on d.id = ui.item_def_id
         join users u on u.id = l.seller_id
        where l.kind = 'item' and d.code = $1 and l.status = 'active' and l.seller_id <> $2
        order by -ln(1 - random()) * power(${IN_COINS}, $3)
        limit $4`,
      [itemCode, user.id, M.offer_bias_k, limit]
    );
    countImpressions(rows.map((r) => r.id));

    const total = await one(
      `select count(*)::int as n
         from market_listings l
         join user_items ui on ui.id = l.user_item_id
         join item_defs d on d.id = ui.item_def_id
        where l.kind = 'item' and d.code = $1 and l.status = 'active' and l.seller_id <> $2`,
      [itemCode, user.id]
    );
    return { offers: rows.map(listingView), total: total.n };
  });

  // Кавенята на продажу — окремий екран.
  app.get("/market/plants", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const limit = clampLimit(req.query?.limit);
    const rows = await many(
      `select l.*, u.nickname as seller, p.name as plant_name, p.growth_stage, p.appearance,
              -- «Стадія 10 · 2 повні комплекти» і мініатюра в одязі, як у кадрі
              (select count(*)::int from wardrobe_sets ws where ws.plant_id = p.id and ws.gifted) as full_sets,
              coalesce((select json_agg(json_build_object('slot', wsi.slot, 'sprite_id', d.sprite_id))
                          from wardrobe_set_items wsi
                          join user_items ui on ui.id = wsi.user_item_id
                          join item_defs d on d.id = ui.item_def_id
                         where wsi.set_id = p.worn_set_id), '[]') as worn
         from market_listings l
         join plants p on p.id = l.plant_id
         join users u on u.id = l.seller_id
        where l.kind = 'plant' and l.status = 'active' and l.seller_id <> $1
        order by -ln(1 - random()) * power(${IN_COINS}, $2)
        limit $3`,
      [user.id, M.offer_bias_k, limit]
    );
    countImpressions(rows.map((r) => r.id));
    return { offers: rows.map(listingView) };
  });

  // Свої лоти з лічильником показів: збережене в Postgres плюс те, що ще
  // лежить у Redis і не перенесене.
  app.get("/me/listings", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = await many(
      `select l.*, d.name as item_name, d.tier, d.slot, d.sprite_id, p.name as plant_name, p.growth_stage
         from market_listings l
         left join user_items ui on ui.id = l.user_item_id
         left join item_defs d on d.id = ui.item_def_id
         left join plants p on p.id = l.plant_id
        where l.seller_id = $1 and l.status = 'active'
        order by l.created_at desc`,
      [user.id]
    );
    const pending = await pendingImpressions(rows.map((r) => r.id));
    return {
      listings: rows.map((row) => ({
        ...listingView(row),
        impressions: row.impressions + (pending[row.id] ?? 0),
        commission_pct: Number(row.commission_pct),
      })),
    };
  });

  // Виставити лот.
  app.post("/market/listings", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const kind = req.body?.kind === "plant" ? "plant" : "item";
    const price = Math.trunc(Number(req.body?.price ?? 0));
    const currency = req.body?.currency === "beans" ? "beans" : "yellow";
    if (!(price > 0)) fail(400, "bad_price");
    if (price < (M.min_price?.[currency] ?? 1)) fail(400, "price_too_low", { min: M.min_price[currency] });

    return tx(async (client) => {
      const commission = M.commission_pct[kind];

      if (kind === "item") {
        const { rows: items } = await client.query(
          "select * from user_items where id = $1 and user_id = $2 for update",
          [Number(req.body?.user_item_id), user.id]
        );
        const item = items[0];
        if (!item) fail(404, "no_such_item");
        if (item.locked) fail(409, "item_locked");
        if (item.listing_id) fail(409, "already_listed");
        if (item.set_id) fail(409, "item_in_set");

        const { rows } = await client.query(
          `insert into market_listings (seller_id, kind, user_item_id, price_amount, price_currency, commission_pct)
           values ($1, 'item', $2, $3, $4, $5) returning *`,
          [user.id, item.id, price, currency, commission]
        );
        await client.query("update user_items set listing_id = $2 where id = $1", [item.id, rows[0].id]);
        return { ok: true, listing_id: rows[0].id, commission_pct: commission };
      }

      const { rows: plants } = await client.query(
        "select * from plants where id = $1 and owner_id = $2 for update",
        [req.body?.plant_id, user.id]
      );
      const plant = plants[0];
      if (!plant) fail(404, "no_such_plant");
      if (plant.listing_id) fail(409, "already_listed");
      // Останнє кавенятко не продається: гравець лишився б із порожнім
      // головним екраном і без способу грати далі.
      const { rows: count } = await client.query(
        "select count(*)::int as n from plants where owner_id = $1 and listing_id is null", [user.id]
      );
      if (count[0].n <= 1) fail(409, "last_plant");

      const { rows } = await client.query(
        `insert into market_listings (seller_id, kind, plant_id, price_amount, price_currency, commission_pct)
         values ($1, 'plant', $2, $3, $4, $5) returning *`,
        [user.id, plant.id, price, currency, commission]
      );
      await client.query("update plants set listing_id = $2 where id = $1", [plant.id, rows[0].id]);
      return { ok: true, listing_id: rows[0].id, commission_pct: commission };
    });
  });

  // Зняти з продажу.
  app.delete("/market/listings/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return tx(async (client) => {
      const { rows } = await client.query(
        "select * from market_listings where id = $1 and seller_id = $2 for update",
        [Number(req.params.id), user.id]
      );
      const listing = rows[0];
      if (!listing) fail(404, "no_such_listing");
      if (listing.status !== "active") fail(409, "not_active");

      await client.query("update market_listings set status = 'cancelled' where id = $1", [listing.id]);
      if (listing.kind === "item") {
        await client.query("update user_items set listing_id = null where id = $1", [listing.user_item_id]);
      } else {
        await client.query("update plants set listing_id = null where id = $1", [listing.plant_id]);
      }
      return { ok: true, kind: listing.kind };
    });
  });

  // Купити лот. Комісія лишається системі, продавець отримує решту.
  app.post("/market/listings/:id/buy", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    return tx(async (client) => {
      const { rows } = await client.query(
        "select * from market_listings where id = $1 for update",
        [Number(req.params.id)]
      );
      const listing = rows[0];
      if (!listing) fail(404, "no_such_listing");
      if (listing.status !== "active") fail(409, "already_gone");
      if (listing.seller_id === user.id) fail(409, "own_listing");

      const column = listing.price_currency === "beans" ? "beans" : "coins_yellow";
      const delta = listing.price_currency === "beans" ? "delta_beans" : "delta_yellow";
      const gross = listing.price_amount;
      const commission = Math.round((gross * Number(listing.commission_pct)) / 100);
      const net = gross - commission;

      const { rows: paid } = await client.query(
        `update users set ${column} = ${column} - $2 where id = $1 and ${column} >= $2 returning ${column} as left`,
        [user.id, gross]
      );
      if (!paid.length) fail(409, "not_enough", { need: gross, currency: listing.price_currency });
      await client.query(`update users set ${column} = ${column} + $2 where id = $1`, [listing.seller_id, net]);

      await client.query(
        `insert into ledger_entries (user_id, ${delta}, reason, meta) values ($1, $2, 'market', $3)`,
        [user.id, -gross, { listing_id: listing.id, role: "buyer" }]
      );
      await client.query(
        `insert into ledger_entries (user_id, ${delta}, reason, meta) values ($1, $2, 'market', $3)`,
        [listing.seller_id, net, { listing_id: listing.id, role: "seller", commission }]
      );

      // Річ або кавенятко змінюють власника в тій самій транзакції, що й
      // гроші: інакше можливий стан «сплачено, але не передано».
      if (listing.kind === "item") {
        await client.query(
          "update user_items set user_id = $2, listing_id = null, acquired_from = 'market' where id = $1",
          [listing.user_item_id, user.id]
        );
      } else {
        await client.query(
          "update plants set owner_id = $2, listing_id = null, worn_set_id = null where id = $1",
          [listing.plant_id, user.id]
        );
      }

      await client.query("update market_listings set status = 'sold' where id = $1", [listing.id]);
      await client.query(
        `insert into market_trades (listing_id, buyer_id, seller_id, gross, commission, net, currency)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [listing.id, user.id, listing.seller_id, gross, commission, net, listing.price_currency]
      );

      const what = listing.kind === "item" ? "Твою річ" : "Твоє кавенятко";
      await notifyPlant(listing.seller_id, `${what} продано на маркеті: +${net} після комісії.`, { client });

      return { ok: true, paid: gross, kind: listing.kind };
    });
  });
}
