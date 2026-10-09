// Склад menu.json — у спільній бібліотеці, бо його читають двоє: scheduler
// (кладе файл у бакет) і api (віддає те саме меню кіоску роутом, поки домен
// бакета не налаштований). Одне джерело правди — таблиця drinks.
//
// Усе інше — бренд, розміри стаканів, період опитування — зашите в кіоск
// (raspberry/kiosk/src/config.h): воно не змінювалось жодного разу, а кожне
// зайве поле в меню — ще одне місце, де бакет і екран розходяться.
// Що написано на плашці панелі. 'none' — панель без плашки.
const PROMO_LABEL = { promo: "АКЦІЯ", notice: "ОГОЛОШЕННЯ", news: "НОВИНА", none: "" };

// Поточна акція — стан у таблиці promos, а не вміст деплойменту: ціни
// котять свідомо (машина, Checkbox), а напис на екрані міняють одним
// вибором в адмінці (рішення власника 23.09.2026).
async function currentAd(client) {
  const { rows } = await client.query(
    `select p.kind, p.head1, p.head2, p.sub, p.fine, d.sprite
       from promos p
       left join drinks d on d.slot = p.drink_code
      where p.is_current and p.archived_at is null`
  );
  const promo = rows[0];
  if (!promo) return null;
  return {
    promo_label: PROMO_LABEL[promo.kind] ?? "",
    head1: promo.head1,
    head2: promo.head2 ?? "",
    sub: promo.sub ?? "",
    fine: promo.fine ?? "",
    sprite: promo.sprite ?? "",
  };
}

// letter — літера машини цієї точки (points.machine_letter). Код позиції в
// меню має бути тим самим, що надрукує каса: кіоск звіряє з ним подію
// bonus_ready, а вона приходить із чека.
//
// discount — знижка в кав'ярні з деплойменту (backend/lib/src/discounts.js):
// { uah, until, drink }. Поки вона діє, ціна знижена рівно на uah, але не
// менше гривні, без округлень (власник, 28.09.2026; розмір —
// shop_beans.pos_discount.uah з economy.json, з 01.10.2026 це 30). drink —
// slot напою знижки (власник, 08.10.2026): знижуємо лише його, бо машина
// міняє ціну окремо на кожен напій. drink не задано (стара знижка) — знижуємо
// всі. У зниженого напою поруч лежить повна ціна (price_full): кіоск повертає
// її сам, щойно until мине, і по ній же малює значок «%» саме на цій картці.
// until_ts — те саме в секундах епохи: кіоску на C так простіше за ISO.
export async function buildMenu(client, letter = "a", { discount } = {}) {
  // active = false прибирає напій з екрана, але лишає в базі: сезонні
  // позиції повертаються, а чеки на них мають на що посилатись.
  const ad = await currentAd(client);
  const { rows } = await client.query(
    `select slot, name, vol, cup, price_uah, color, foam, sprite, coins, is_bonus
       from drinks
      where active
      order by sort_order, name`
  );
  if (!rows.length) throw new Error("у базі немає активних напоїв");

  const until = discount?.until ? new Date(discount.until) : null;
  const uah = Number(discount?.uah) || 0;
  const drinkSlot = discount?.drink ?? null;   // null — стара знижка на всі напої
  const live = Boolean(until && until > new Date() && uah > 0);
  const lowered = (full) => Math.max(1, full - uah);
  const applies = (d) => live && (drinkSlot === null || d.slot === drinkSlot);

  return {
    updated: new Date().toISOString().slice(0, 10),
    ...(live ? { discount: {
      uah, until: until.toISOString(), until_ts: Math.floor(until.getTime() / 1000),
      ...(drinkSlot ? { drink: `${letter}${drinkSlot}` } : {}),
    } } : {}),
    drinks: rows.map((d) => ({
      name: d.name,
      vol: d.vol ?? "",
      price: applies(d) ? lowered(Number(d.price_uah)) : Number(d.price_uah),
      ...(applies(d) ? { price_full: Number(d.price_uah) } : {}),
      color: d.color ?? "#402212",
      foam: d.foam,
      cup: d.cup ?? "M",
      sprite: d.sprite ?? "",
      system_code: `${letter}${d.slot}`,
      // Монети показуємо лише на бонусних позиціях — там це ціна. У
      // звичайного напою coins — заробіток гравця, і екрану в залі він ні
      // про що не каже.
      ...(d.is_bonus ? { is_bonus: true, coins: d.coins } : {}),
    })),
    ...(ad ? { ad } : {}),
  };
}
