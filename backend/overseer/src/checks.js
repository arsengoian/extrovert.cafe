// Перевірки overseer. Кожна повертає стан, а не текст алерту: вирішувати,
// чи писати в чат, — справа виклику (алерт лише на зміну стану).
const SILENT_MINUTES = 15;                 // малина шле телеметрію частіше

const human = (minutes) => {
  if (minutes < 60) return `${Math.round(minutes)} хв`;
  const hours = minutes / 60;
  return hours < 24 ? `${hours.toFixed(1)} год` : `${(hours / 24).toFixed(1)} діб`;
};

// Точка «жива», поки шле телеметрію. Порівнюємо з last_seen_at, який
// оновлює api на кожен пінг малини.
export async function checkPoints(pool) {
  const { rows } = await pool.query(
    `select id, name, last_seen_at,
            extract(epoch from (now() - last_seen_at)) / 60 as silent_minutes
       from points where status = 'live'`
  );
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    state: p.last_seen_at && p.silent_minutes < SILENT_MINUTES ? "ok" : "silent",
    silentFor: p.last_seen_at ? human(p.silent_minutes) : "від самого початку",
  }));
}

// Checkbox сам розповідає, чи доходили до нас його вебхуки: last_error_date
// у GET /api/v1/webhook. Дірки в даних мають бути видимі, а не мовчазні
// (docs/checkbox.md).
export async function checkWebhook() {
  const login = process.env.CHECKBOX_LOGIN;
  const password = process.env.CHECKBOX_PASSWORD;
  if (!login || !password) return null;

  const api = process.env.CHECKBOX_API || "https://api.checkbox.ua";
  try {
    const auth = await fetch(`${api}/api/v1/cashier/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    if (!auth.ok) return { state: "unreachable", message: `signin HTTP ${auth.status}` };
    const { access_token: token } = await auth.json();

    // X-License-Key обов'язковий: налаштування вебхука зберігаються на касу,
    // а не на організацію. Без нього Checkbox відповідає 422, і дашборд
    // півдоби писав «не зареєстрований» про робочий вебхук (23.09.2026).
    const license = process.env.CHECKBOX_LICENSE_KEY;
    const res = await fetch(`${api}/api/v1/webhook`, {
      headers: { authorization: `Bearer ${token}`, ...(license ? { "X-License-Key": license } : {}) },
    });
    if (res.status === 422) return { state: "unknown", message: "не спитати: немає CHECKBOX_LICENSE_KEY" };
    // 404 — на цій касі вебхука справді немає. Це не поломка (чеки підбирає
    // опитування), але знати про це треба: вебхук реєструють на кожну касу
    // окремо.
    if (res.status === 404) return { state: "unknown", message: "на цій касі вебхук не зареєстрований" };
    if (!res.ok) return { state: "unknown", message: `webhook HTTP ${res.status}` };

    // 200 з тілом `null` — окремий випадок, і саме він 23.09.2026 о 14:37
    // прилетів у Telegram як «null is not an object». Checkbox так
    // відповідає, коли для цієї каси налаштувань вебхука в нього немає, —
    // при тому що чеки до нас доходять саме вебхуком (receipts.source).
    // Тобто це не поломка, а «не спитати»: мовчимо, а не лякаємо.
    const hook = await res.json().catch(() => null);
    if (!hook || typeof hook !== "object") {
      return { state: "unknown", message: "Checkbox не показує налаштувань вебхука для цієї каси" };
    }
    if (!hook.last_error_date) return { state: "ok", message: "без помилок" };
    return {
      state: "failing",
      message: `остання помилка ${new Date(hook.last_error_date).toLocaleString("uk-UA")} — ${hook.last_error_message ?? "без тексту"}`,
    };
  } catch (e) {
    return { state: "unreachable", message: e.message };
  }
}

// Зведення за вчора: продажі, бонуси, замовлення, скарги. Саме те, що
// власник інакше йшов би дивитись у базу руками.
export async function dailyReport(pool) {
  const { rows: [sales] } = await pool.query(
    `select count(*)::int as receipts, coalesce(sum(total_sum), 0) as sum
       from receipts
      where fiscal_date >= date_trunc('day', now() - interval '1 day')
        and fiscal_date <  date_trunc('day', now())`
  );
  const { rows: [bonuses] } = await pool.query(
    `select count(*)::int as granted,
            count(*) filter (where redeemed_by is not null)::int as redeemed
       from bonus_grants bg join receipts r on r.id = bg.receipt_id
      where r.fiscal_date >= date_trunc('day', now() - interval '1 day')
        and r.fiscal_date <  date_trunc('day', now())`
  );
  const { rows: [players] } = await pool.query(
    `select count(*)::int as new_players from users
      where created_at >= date_trunc('day', now() - interval '1 day')
        and created_at <  date_trunc('day', now())`
  );
  const { rows: [orders] } = await pool.query(
    "select count(*)::int as open from redemptions where status not in ('received', 'cancelled', 'returned')"
  );
  const { rows: [problems] } = await pool.query(
    `select count(*)::int as fresh from problem_reports
      where created_at >= now() - interval '1 day'`
  );

  const share = bonuses.granted ? Math.round((bonuses.redeemed / bonuses.granted) * 100) : 0;
  return [
    "<b>Учора</b>",
    `Чеків: ${sales.receipts} на ${Number(sales.sum).toFixed(2)} ₴`,
    `Бонуси: видано ${bonuses.granted}, забрали ${bonuses.redeemed} (${share}%)`,
    `Нових гравців: ${players.new_players}`,
    `Відкритих замовлень: ${orders.open}`,
    problems.fresh ? `⚠️ Скарг за добу: ${problems.fresh}` : "Скарг немає",
  ].join("\n");
}
