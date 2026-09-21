// Outbox: подія для кіоска чи телефона пишеться в ту саму транзакцію, що й
// зміна, яку вона описує (db-schema §0). Інакше між комітом чека й
// PUBLISH у Redis лишається щілина, у якій бонус є, а кіоск про нього не
// дізнався.
//
// Доставка «принаймні раз»: публікатор може впасти між відправкою в Redis і
// позначкою published_at, тому в кожній події їде її outbox.id — клієнт
// відкидає повтор.
export async function enqueue(client, channel, event, payload) {
  const { rows } = await client.query(
    "insert into outbox (channel, event, payload) values ($1, $2, $3) returning id",
    [channel, event, payload]
  );
  return rows[0].id;
}

// Забираємо пачку неопублікованих рядків із `for update skip locked`: дві
// копії сервісу не візьмуть ту саму подію, а зайнятий рядок не блокує
// чергу.
export async function drain(pool, redis, { limit = 100, log } = {}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id, channel, event, payload from outbox
        where published_at is null
        order by id
        limit $1
        for update skip locked`,
      [limit]
    );
    if (!rows.length) { await client.query("commit"); return 0; }

    for (const row of rows) {
      const message = JSON.stringify({ id: row.id, event: row.event, ...row.payload });
      try {
        await redis.publish(row.channel, message);
        await client.query("update outbox set published_at = now() where id = $1", [row.id]);
      } catch (e) {
        // Не вдалось — лишаємо неопублікованим і рахуємо спробу: наступний
        // прохід візьме його знову.
        await client.query("update outbox set attempts = attempts + 1 where id = $1", [row.id]);
        log?.warn("outbox: подія не відправилась", { id: row.id, err: e.message });
      }
    }
    await client.query("commit");
    return rows.length;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
