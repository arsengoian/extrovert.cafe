// Один пул на процес. Сервіс не тримає жодної схемної логіки: усе, що є в
// базі, приїхало з db/migrations (docs/db-schema.md §6).
import pg from "pg";

// numeric приходить рядком, щоб не втратити копійки на float. Нам у грошах
// потрібні саме числа, тож парсимо явно там, де це безпечно: numeric(10,2).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (bigint) теж рядком за замовчуванням: id-шники в нас у межах Number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const url =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || "extrovert"}:${process.env.POSTGRES_PASSWORD}` +
    `@${process.env.PGHOST || "postgres"}:5432/${process.env.POSTGRES_DB || "extrovert"}`;

export const pool = new pg.Pool({ connectionString: url, max: 8 });

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Баланс і журнал змінюються в одній транзакції — інакше вони розійдуться
// (docs/db-schema.md §0). Кожен виклик, що чіпає гроші, іде через це.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
