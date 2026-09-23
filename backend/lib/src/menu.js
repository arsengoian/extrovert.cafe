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
       left join drinks d on d.system_code = p.drink_code
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

export async function buildMenu(client) {
  // active = false прибирає напій з екрана, але лишає в базі: сезонні
  // позиції повертаються, а чеки на них мають на що посилатись.
  const ad = await currentAd(client);
  const { rows } = await client.query(
    `select system_code, name, vol, cup, price_uah, color, foam, sprite, coins, is_bonus
       from drinks
      where active
      order by sort_order, name`
  );
  if (!rows.length) throw new Error("у базі немає активних напоїв");

  return {
    updated: new Date().toISOString().slice(0, 10),
    drinks: rows.map((d) => ({
      name: d.name,
      vol: d.vol ?? "",
      price: Number(d.price_uah),
      color: d.color ?? "#402212",
      foam: d.foam,
      cup: d.cup ?? "M",
      sprite: d.sprite ?? "",
      system_code: d.system_code,
      // Монети показуємо лише на бонусних позиціях — там це ціна. У
      // звичайного напою coins — заробіток гравця, і екрану в залі він ні
      // про що не каже.
      ...(d.is_bonus ? { is_bonus: true, coins: d.coins } : {}),
    })),
    ...(ad ? { ad } : {}),
  };
}
