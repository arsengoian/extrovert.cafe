// Знижки в кав'ярні: кінець за часом і повернення зерен, якщо знижене меню
// не доїхало (backend/lib/src/discounts.js). Кінець за першим чеком робить
// checkbox у тій самій транзакції, що й чек.
//
// Раз на кілька секунд: вікно знижки — дві хвилини, і відлік на кіоску
// закінчується рівно тоді, коли меню з повними цінами вже має їхати.
import { expireDiscounts, refundFailed } from "@extrovert/lib/discounts.js";

export async function runDiscounts({ pool }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const expired = await expireDiscounts(client);
    const refunded = await refundFailed(client);
    await client.query("commit");
    if (!expired && !refunded) return null;
    return { done: `знижки: скінчилось ${expired}, повернуто зерна за ${refunded}` };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
