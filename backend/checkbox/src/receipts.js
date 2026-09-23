// Прийом чека з Checkbox — спільний шлях для вебхука й опитування.
//
// Гарантувати, що чек прийде рівно раз, не може ні Checkbox, ні мережа.
// Гарантувати можна інше: другий прихід того самого чека нічого не зробить.
// Це робить унікальний ключ у базі (`checkbox_receipt_id`), а не перевірка
// «чи вже було» перед вставкою — між нею й вставкою проскакує другий шлях
// (docs/checkbox.md, «Наш приймач»).
import { pool } from "@extrovert/lib/db.js";
import { enqueue } from "@extrovert/lib/outbox.js";

// Суми Checkbox тримає в копійках — переводимо тут і більше ніде
// (db-schema §0).
const uah = (kopiyky) => Math.round(Number(kopiyky ?? 0)) / 100;

const SHOW_MINUTES = 2;                    // скільки QR висить на екрані кіоска
const token = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

// Точку визначаємо за філією Checkbox: один касовий термінал — одна точка.
async function pointFor(client, receipt) {
  const branch = receipt.branch?.id ?? receipt.cash_register?.branch_id ?? null;
  if (branch) {
    const { rows } = await client.query("select id from points where checkbox_branch_id = $1", [branch]);
    if (rows.length) return rows[0].id;
  }
  // Поки точка одна, це не здогадка, а факт; коли стане більше — філія в
  // points заповнена, і ця гілка перестане спрацьовувати.
  const { rows } = await client.query("select id from points order by created_at limit 1");
  return rows[0]?.id ?? null;
}

export async function ingest(receipt, { source, log }) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const pointId = await pointFor(client, receipt);
    if (!pointId) throw new Error("немає жодної точки — нікуди записати чек");

    const { rows } = await client.query(
      `insert into receipts (point_id, checkbox_receipt_id, checkbox_shift_id, fiscal_code,
                             fiscal_date, total_sum, payments, tax_url, source, raw)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (checkbox_receipt_id) do nothing
       returning id`,
      [
        pointId, receipt.id, receipt.shift?.id ?? null, receipt.fiscal_code ?? null,
        receipt.fiscal_date ?? new Date().toISOString(), uah(receipt.total_sum),
        // jsonb — рядком: масив (payments) драйвер інакше віддає як масив
        // Postgres, і вставка падає на «invalid input syntax for type json».
        receipt.payments ? JSON.stringify(receipt.payments) : null,
        receipt.tax_url ?? null, source, JSON.stringify(receipt),
      ]
    );

    // Другий прихід того самого чека: рядок не додався — виходимо мовчки,
    // не створивши ні позицій, ні бонусу.
    if (!rows.length) {
      await client.query("commit");
      return { duplicate: true };
    }
    const receiptId = rows[0].id;

    const goods = receipt.goods ?? [];
    let coins = 0;
    // Напій, який поїде на екран кіоска в рядку бонусу. Беремо той, що
    // дав монети (перший платний із каталогу) — саме його людина щойно
    // купила й упізнає на панелі.
    let shown = null;
    for (const line of goods) {
      const g = line.good ?? line;
      const code = g.code ?? g.system_code ?? "";
      const qty = Number(line.quantity ?? 1000) / 1000;      // Checkbox: тисячні
      const price = uah(g.price);
      const { rows: drink } = await client.query(
        "select coins, bonus_coins from drinks where system_code = $1", [code]
      );
      // Код, якого немає в каталозі, — це не дрібниця: монет за такий напій
      // не нарахується, і мовчки. Найімовірніша причина — друга машина:
      // Зернова нумерує позиції з літери машини (a…, b…), тож той самий
      // напій приходить із чужим префіксом (з'ясовано 23.09.2026).
      if (!drink.length && Number(g.price ?? 0) > 0) {
        log?.warn("напою немає в каталозі — монети не нараховані", {
          код: code, точка: pointId, назва: g.name ?? null,
        });
      }
      // Бонус-напій монет не дає: він сам і є бонусом (economy §7.1).
      const isBonus = Number(g.price ?? 0) === 0 || (drink[0]?.coins ?? 0) === 0;
      if (drink.length && !isBonus) {
        coins += Math.round(drink[0].coins * qty);
        shown ??= { code, name: g.name ?? code };
      }

      await client.query(
        `insert into receipt_items (receipt_id, system_code, name, qty, price_uah, sum_uah, is_bonus_drink)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [receiptId, code, g.name ?? code, qty, price, uah(line.sum ?? g.price), isBonus]
      );
    }

    // Бонус прив'язаний до чека, а не до часу: дві хвилини — це лише
    // скільки QR висить на екрані кіоска (show_until, звідти ж
    // expires_in_s для попапа). Сам токен не згоряє: сфотографував код —
    // забереш і через півроку (рішення власника 23.09.2026). Секретом тут
    // є сам токен, а світиться він лише на екрані тієї покупки.
    const claim = token();
    await client.query(
      `insert into bonus_grants (receipt_id, point_id, coins_yellow, claim_token, show_until)
       values ($1, $2, $3, $4, now() + interval '${SHOW_MINUTES} minutes')`,
      [receiptId, pointId, coins, claim]
    );

    // Подія для кіоска — у тій самій транзакції (db-schema §0): інакше
    // можливий чек без QR на екрані.
    // code — щоб кіоск узяв назву й картинку зі свого ж меню (він його вже
    // тримає), name — запасний варіант, коли напою в меню точки немає.
    await enqueue(client, `point:${pointId}`, "bonus_ready", {
      receipt_id: receiptId,
      code: shown?.code ?? "",
      drink: shown?.name ?? "",
      coins,
      claim_token: claim,
      expires_in_s: SHOW_MINUTES * 60,
    });

    await client.query("commit");
    log?.info("чек прийнято", { receipt: receipt.id, source, coins, items: goods.length });
    return { duplicate: false, receiptId, coins, claim };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
