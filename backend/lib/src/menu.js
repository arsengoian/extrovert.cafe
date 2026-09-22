// Склад menu.json — у спільній бібліотеці, бо його читають двоє: scheduler
// (кладе файл у бакет) і api (віддає те саме меню кіоску роутом, поки домен
// бакета не налаштований). Одне джерело правди — таблиця drinks.
//
// Усе інше — бренд, розміри стаканів, період опитування — зашите в кіоск
// (raspberry/kiosk/src/config.h): воно не змінювалось жодного разу, а кожне
// зайве поле в меню — ще одне місце, де бакет і екран розходяться.
export async function buildMenu(client, ad) {
  // active = false прибирає напій з екрана, але лишає в базі: сезонні
  // позиції повертаються, а чеки на них мають на що посилатись.
  const { rows } = await client.query(
    `select system_code, name, vol, cup, price_uah, color, foam, sprite, bonus_coins
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
      // Нуль у меню не потрібен: картка з бейджем бонусу й без нього — різні
      // шаблони, і кіоск вибирає їх саме за наявністю поля.
      ...(d.bonus_coins > 0 ? { bonus_coins: d.bonus_coins } : {}),
    })),
    ...(ad ? { ad } : {}),
  };
}
