// Перевірки overseer. Кожна повертає стан, а не текст алерту: вирішувати,
// чи писати в чат, — справа виклику (алерт лише на зміну стану).
// Малина шле пробу раз на хвилину (stack/telemetry.sh), тож три хвилини
// мовчання — це вже три пропущені проби поспіль, а не «мережа моргнула».
// Разом із хвилинним обходом це означає: точка впала — знаємо за 3-4 хв.
const SILENT_MINUTES = 3;

const human = (minutes) => {
  if (minutes < 60) return `${Math.round(minutes)} хв`;
  const hours = minutes / 60;
  return hours < 24 ? `${hours.toFixed(1)} год` : `${(hours / 24).toFixed(1)} діб`;
};

// Поломки, які видно лише в телеметрії: екран малює, точка «на звʼязку», а
// насправді щось уже не так. Кожна — окремий стан, щоб алерт приходив і
// зникав сам (прохання власника 24.09.2026: «у кожному випадку поломки має
// приходити відразу звіт в overseer»).
//
// Біти vcgencmd get_throttled: 0x1 — просідає живлення ЗАРАЗ, 0x4 — частота
// зрізана зараз. «Було колись» (0x10000+) не алертимо: воно лишається
// назавжди до перезавантаження й перетворилось би на вічне попередження.
const DEVICE_CHECKS = [
  {
    key: "power",
    bad: (m) => Number.isFinite(m.throttled) && (m.throttled & 0x5) !== 0,
    down: () => "просідає живлення — це вбиває картку памʼяті, перевір блок і кабель",
    up: () => "живлення в нормі",
    icon: "⚡",
  },
  {
    key: "card",
    bad: (m) => m.root_ro === true,
    down: () => "картка стала read-only: оновлення не встановиться, стан не збережеться",
    up: () => "картка знову пишеться",
    icon: "💾",
  },
  {
    key: "monitor",
    // null — «не знаємо» (немає ні CEC, ні tvservice): мовчимо.
    bad: (m) => m.monitor_on === false,
    down: (m) => (m.monitor_src === "cec" ? "монітор у режимі очікування" : "монітор не відповідає (немає EDID — кабель чи живлення)"),
    up: () => "монітор увімкнено",
    icon: "🖥",
  },
  {
    key: "kiosk",
    // Кіоск живий, але не малює. fps приходить із його ж сокета, тож null —
    // це «сокет не відповів», теж погано.
    bad: (m) => m.kiosk_fps !== undefined && (m.kiosk_fps === null || Number(m.kiosk_fps) <= 0),
    down: () => "меню не малюється (0 fps)",
    up: () => "меню малюється",
    icon: "🖼",
  },
  {
    key: "disk",
    bad: (m) => Number.isFinite(m.disk_free_mb) && m.disk_free_mb < 300,
    down: (m) => `на картці лишилось ${Math.round(m.disk_free_mb)} МБ`,
    up: () => "місця на картці вистачає",
    icon: "💽",
  },
];

// Стан кожної перевірки для кожної живої точки — за останньою пробою.
// Проба старіша за SILENT_MINUTES не розглядається: про мовчазну точку вже
// сказав checkPoints, і дублювати його пʼятьма алертами не треба.
export async function checkDevices(pool) {
  const { rows } = await pool.query(
    `select p.id, p.name, t.metrics, t.measured_at
       from points p
       join lateral (
         select metrics, measured_at from device_telemetry
          where point_id = p.id and source = 'pi'
          order by measured_at desc limit 1) t on true
      where p.status = 'live'
        and t.measured_at > now() - make_interval(mins => $1)`,
    [SILENT_MINUTES]
  );

  const out = [];
  for (const row of rows) {
    const m = row.metrics ?? {};
    for (const check of DEVICE_CHECKS) {
      const bad = Boolean(check.bad(m));
      out.push({
        key: `${row.id}:${check.key}`,
        state: bad ? "bad" : "ok",
        text: bad
          ? `${check.icon} ${row.name}: ${check.down(m)}`
          : `✅ ${row.name}: ${check.up(m)}`,
      });
    }
  }
  return out;
}

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
      // Формулювання читає власник у картці дашборда, тож воно має казати
      // не лише «не видно», а й «і це не поломка»: перевірено 24.09.2026 —
      // чеки в цей самий час ішли саме вебхуком (receipts.source).
      return { state: "unknown", message: "Checkbox не показує налаштувань цієї каси — стежимо по чеках" };
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
