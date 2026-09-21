// Покази лотів маркету: Redis → Postgres раз на хвилину.
//
// api рахує покази в хеші `market:impressions`, бо писати в Postgres на
// кожен показ — це до десяти оновлень гарячих рядків на одне відкриття
// прев'ю. Тут ключ атомарно перейменовується, і накопичене переноситься
// одним update: покази, що прийшли під час перенесення, падають уже в
// новий ключ (services.md §4).
const KEY = "market:impressions";
const FLUSH = "market:impressions:flush";

export async function flushImpressions({ pool, redis, log }) {
  // Хвіст попереднього падіння: якщо flush лишився з минулого разу, спершу
  // доносимо його, інакше покази загубляться.
  const leftover = await redis.exists(FLUSH);
  if (!leftover) {
    const renamed = await redis.renamenx(KEY, FLUSH).catch(() => 0);
    if (!renamed) return {};
  }

  const counts = await redis.hgetall(FLUSH);
  const entries = Object.entries(counts ?? {});
  if (!entries.length) { await redis.del(FLUSH); return {}; }

  const ids = entries.map(([id]) => Number(id));
  const values = entries.map(([, n]) => Number(n));
  try {
    await pool.query(
      `update market_listings l
          set impressions = l.impressions + v.n
         from (select unnest($1::bigint[]) as id, unnest($2::int[]) as n) v
        where l.id = v.id`,
      [ids, values]
    );
  } catch (e) {
    // Не змогли записати — лишаємо flush на місці, наступний прохід
    // спробує знову. Подвоєння не буде: ключ ще не видалений.
    log?.error("покази не перенеслись", e);
    return {};
  }
  await redis.del(FLUSH);
  return { done: `покази перенесено: ${entries.length} лотів`, extra: { total: values.reduce((a, b) => a + b, 0) } };
}
