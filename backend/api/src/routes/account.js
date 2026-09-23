// Видалення акаунта.
//
// Рядок у базі лишається — зникає людина. Причина не в лінощах: на історії
// покупок тримається вся аналітика точки й економіки, а угода на маркеті
// має двох учасників, і стерти одного означає зламати картину другому.
//
// У публічній частині після видалення від людини не лишається нічого
// (перевірено 23.09.2026): активні лоти знімаються, а всі запити ринку
// беруть лише `status = 'active'`; самі угоди (market_trades) гравцям не
// показуються ніде — вони є тільки у зведеннях адмінки; нікнейм, який
// бачили інші, замінюється на deleted_account_<n>, а старий лягає в
// deleted_nickname для підтримки.
//
// Тому:
//
//   • пошта затирається, способи входу (пошта, Google) видаляються —
//     увійти в цей акаунт більше не можна нізвідки, а та сама пошта
//     наступного разу заведе новий акаунт;
//   • нікнейм звільняється (deleted_account_<n>), старий лягає в
//     deleted_nickname, щоб підтримка могла звести стару скаргу з акаунтом;
//   • лоти знімаються з маркету: продавця, який уже не зайде, там бути не
//     має;
//   • кавенятка, предмети, чеки й журнал лишаються як є.
//
// GDPR-режиму «стерти все» ми свідомо не робимо (gamification_ui.md §MVP).
import { one, tx } from "../db.js";
import { requireUser } from "../auth.js";
import { fail } from "../errors.js";
import { dropUserSessions, clearCookie } from "../session.js";

export default async function routes(app) {
  // Що саме зникне, а що лишиться — показуємо до кнопки, а не після.
  app.get("/me/deletion", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const counts = await one(
      `select
         (select count(*)::int from plants where owner_id = $1 and listing_id is null) as plants,
         (select count(*)::int from user_items where user_id = $1) as items,
         (select count(*)::int from market_listings where seller_id = $1 and status = 'active') as listings,
         (select coins_yellow + coins_silver from users where id = $1) as coins,
         (select beans from users where id = $1) as beans`,
      [user.id]
    );
    // Список «що лишиться» звідси прибрано 23.09.2026 разом із блоком на
    // екрані: це наша внутрішня бухгалтерія. Числа лишаються — з них екран
    // будує один рядок попередження.
    return counts;
  });

  app.post("/me/deletion", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    // Підтвердження словом: видалення незворотне, і випадковий тап по
    // кнопці не має його запускати.
    if (String(req.body?.confirm ?? "").trim().toLowerCase() !== "видалити") {
      fail(400, "confirm_required");
    }

    const result = await tx(async (client) => {
      const { rows } = await client.query(
        "select id, nickname, deleted_at from users where id = $1 for update",
        [user.id]
      );
      const row = rows[0];
      if (!row) fail(404, "no_such_user");
      if (row.deleted_at) fail(409, "already_deleted");

      // Номер у новому нікнеймі — з послідовності видалених, а не з id:
      // id-шник акаунта не має світитися в тому, що бачать інші гравці.
      const { rows: seq } = await client.query(
        "select count(*)::int + 1 as n from users where deleted_at is not null"
      );
      const newNickname = `deleted_account_${seq[0].n}`;

      await client.query(
        `update users
            set deleted_at = now(),
                deleted_nickname = nickname,
                nickname = $2,
                email = null,
                metadata = metadata - 'qr_pos' || jsonb_build_object('deleted', true)
          where id = $1`,
        [user.id, newNickname]
      );
      // Вхід більше нізвідки: способи входу прибираємо зовсім.
      await client.query("delete from user_identities where user_id = $1", [user.id]);

      // Лоти знімаються: купити в акаунта, який уже не зайде, не має сенсу
      // ні для покупця, ні для нас.
      const { rows: pulled } = await client.query(
        "update market_listings set status = 'cancelled' where seller_id = $1 and status = 'active' returning id, kind, user_item_id, plant_id",
        [user.id]
      );
      for (const lot of pulled) {
        if (lot.kind === "item") {
          await client.query("update user_items set listing_id = null where id = $1", [lot.user_item_id]);
        } else {
          await client.query("update plants set listing_id = null where id = $1", [lot.plant_id]);
        }
      }

      return { nickname: newNickname, listings_cancelled: pulled.length };
    });

    // Сесії гасимо тут же й на всіх пристроях: токен живе 15 хвилин, і
    // лишати вхід у щойно видалений акаунт навіть на цей час нема потреби.
    await dropUserSessions(user.id);
    reply.header("set-cookie", clearCookie());

    return { ok: true, ...result };
  });
}
