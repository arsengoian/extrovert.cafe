// Перевірки overseer. Кожна повертає стан, а не текст алерту: вирішувати,
// чи писати в чат, — справа виклику (алерт лише на зміну стану).
// Скільки точці можна мовчати — рахуємо з її ж ритму, а не з константи.
//
// 24.09.2026 тут стояло фіксовані 3 хвилини «бо малина шле щохвилини». Малина
// шле раз на 313 секунд: період заданий у config/env на самій точці, і дефолт
// у telemetry.sh його не перебиває. Вийшов маятник — «мовчить 4 хв» і «знову
// на звʼязку» по колу кожні пʼять хвилин, рівно між пробами.
//
// Урок не про число, а про звʼязність: поріг на сервері й період на пристрої
// оновлюються різними шляхами (деплой і реліз через бакет) і збігаються не
// завжди. Тому сервер дивиться, ЯК ЧАСТО точка озивалась насправді, і рахує
// поріг від цього. Поміняли період на точці — поріг поїде за ним сам.
const SILENT_FLOOR_MIN = 3;    // швидше однаково не дізнаємось: обхід раз на хвилину
const SILENT_CEIL_MIN = 20;    // довше мовчання — це вже точно не «проба спізнилась»
const SILENT_DEFAULT_MIN = 15; // ритму ще не знаємо (перша доба точки)

// Ритм точки: середній проміжок між останніми пробами. `lateral` — щоб
// рахувати по кожній точці окремо й не тягти всю таблицю.
const POINTS_SQL = `
  select p.id, p.name, p.last_seen_at,
         extract(epoch from (now() - p.last_seen_at)) / 60 as silent_minutes,
         t.period_s
    from points p
    left join lateral (
      select extract(epoch from (max(measured_at) - min(measured_at))) / nullif(count(*) - 1, 0) as period_s
        from (select measured_at from device_telemetry
               where point_id = p.id and source = 'pi'
               order by measured_at desc limit 10) recent) t on true
   where p.status = 'live'`;

// Два періоди плюс хвилина, а не три плюс хвилина (25.09.2026). Телеметрія
// не втрачає проб: не пішло — чекає в черзі й доїде наступним колом. Тому
// ОДНА невдала відправка — це не поломка, і поріг має бути більший за два
// періоди; а от дві поспіль — це вже справжній обрив, і чекати ще одного
// кола немає сенсу. Власник висмикнув кабель на 4,5 хвилини й не дочекався
// алерту: при ритмі 74 с старий множник давав поріг 4,7 хв, і вікно, у
// якому обхід міг це помітити, було вужче за сам обхід.
export function silenceLimit(periodSeconds) {
  if (!periodSeconds) return SILENT_DEFAULT_MIN;
  const minutes = (periodSeconds * 2) / 60 + 1;
  return Math.min(SILENT_CEIL_MIN, Math.max(SILENT_FLOOR_MIN, minutes));
}

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
// Правило списку: **на кожен показник, який шле малина, тут є рядок** —
// або перевірка, або явна причина, чому її немає. Інакше показник тихо
// живе в базі й не значить нічого. Станом на 24.09.2026 без алерту свідомо
// лишились:
//   video_ok  — камери фізично немає, і поки CAMERA_URL порожній, метрика
//               чесно false цілодобово; алерт був би вічним. Рядок на
//               дашборді в неї є, і він там червоний.
//   cpu       — сам по собі нічого не означає: Pi 1 на 100 % CPU — це
//               звичайна збірка меню. Поломку видно через kiosk_fps.
//   release   — «точка не оновлюється» перевіряється не тут: щоб про це
//               судити, треба знати, який реліз мав приїхати (маніфест у
//               бакеті), а не лише який стоїть.
//   monitor_src / monitor_woke / kiosk_frames — не стани, а пояснення до
//               інших показників; вони йдуть у текст алерту.
//
// Біти vcgencmd get_throttled: 0x1 — просідає живлення ЗАРАЗ, 0x4 — частота
// зрізана зараз. «Було колись» (0x10000+) не алертимо: воно лишається
// назавжди до перезавантаження й перетворилось би на вічне попередження.
//
// `bad` бачить дві речі: останню пробу й останні до трьох проб. Показники,
// які або зламані, або ні (картка read-only, флешка, fps), судимо по
// останній. Шумні — температуру, втрати пакетів, памʼять — лише коли ВСІ
// останні проби погані: одна загублена пінг-пачка з пʼяти буває щодня, і
// алерт на неї став би маятником, як 24.09.2026 із порогом мовчання.
const steady = (recent, bad) => recent.length > 0 && recent.every(bad);

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
    // Коли ми його одразу й розбудили — так і кажемо: людині важливо знати
    // не «екран спав», а «екран спав, і вже не спить» (24.09.2026).
    down: (m) => (m.monitor_woke
      ? "монітор увімкнено автоматично"
      : m.monitor_src === "cec-silent"
        ? "монітор не відповідає — перевір кабель і живлення екрана"
        : "монітор у режимі очікування"),
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
  {
    // Флешка під запис відео (video.md). null — RECORDER_BUF не заданий,
    // тобто писати нікуди й не збирались: це не поломка.
    key: "usb",
    bad: (m) => m.usb_ok === false,
    down: () => "флешка не пишеться або не змонтована — відео нема куди писати",
    up: () => "флешка на місці",
    icon: "🔌",
  },
  {
    // 80 °C — за пʼять градусів до тротлінгу Pi. Три проби поспіль, бо
    // хвилинний стрибок на збірці меню — не поломка.
    key: "temp",
    bad: (m, recent) => steady(recent, (x) => Number.isFinite(x.temp_c) && x.temp_c >= 80),
    down: (m) => `перегрів ${Math.round(m.temp_c)} °C — перевір, чи не затулений корпус`,
    up: () => "температура в нормі",
    icon: "🌡",
  },
  {
    // Половина пакетів — це вже не «інтернет підгальмовує». Повний обрив
    // сюди не дійде: про нього скаже мовчання точки.
    key: "net",
    bad: (m, recent) => steady(recent, (x) => Number.isFinite(x.loss_pct) && x.loss_pct >= 50),
    down: (m) => `інтернет ледве живий: втрати ${Math.round(m.loss_pct)} %`,
    up: () => "інтернет у нормі",
    icon: "📶",
  },
  {
    // Памʼять має сенс лише у відсотках від того, скільки її є, — тому
    // перевірка мовчить, доки на точці старий telemetry.sh без mem_total_mb.
    key: "memory",
    bad: (m, recent) => steady(recent, (x) =>
      Number.isFinite(x.mem_total_mb) && x.mem_total_mb > 0 && x.mem_used_mb / x.mem_total_mb > 0.92),
    down: (m) => `памʼять майже скінчилась: ${Math.round(m.mem_used_mb)} з ${Math.round(m.mem_total_mb)} МБ`,
    up: () => "памʼяті вистачає",
    icon: "🧠",
  },
];

// Перезавантаження — подія, а не стан: писати «точка перезавантажилась», а
// через десять хвилин «уже не перезавантажується» безглуздо. Тому одне
// повідомлення на подію, а не пара «зламалось / полагодилось».
//
// Знати про це треба: раптовий ребут без нашого оновлення — це або просіло
// живлення, або хтось висмикнув шнур. Саме той випадок, коли решта
// показників за хвилину знову зелені й поломки ніби й не було.
//
// Шукаємо не «малий аптайм», а аптайм, що ПІШОВ НАЗАД між двома сусідніми
// пробами. Спокуса порахувати момент старту (`measured_at - uptime`) і
// взяти його за ключ виглядає простішою, але вона хибна: обидва доданки
// повзуть, і округлення до хвилини на межі дає то одну хвилину, то сусідню
// — тобто «точка перезавантажилась» приходило б знову й знову на той самий
// старт. Аптайм, що зменшився, — факт без округлень.
export function rebootKey(probes) {
  const [last, prev] = probes;
  if (!prev) return null;                       // одна проба — порівнювати нема з чим
  const now = last.metrics?.uptime_s, before = prev.metrics?.uptime_s;
  if (!Number.isFinite(now) || !Number.isFinite(before) || now >= before) return null;
  // Ключ — саме та проба, у якій це вперше видно: другий обхід по тих самих
  // пробах (телеметрія спізнюється) нічого не повторить.
  return `boot:${new Date(last.measured_at).toISOString()}`;
}

// Стан кожної перевірки для кожної живої точки — за останніми пробами.
// Проба старіша за поріг мовчання не розглядається: про мовчазну точку вже
// сказав checkPoints, і дублювати його вісьмома алертами не треба.
export async function checkDevices(pool) {
  const { rows } = await pool.query(
    `select p.id, p.name, t.metrics, t.measured_at,
            extract(epoch from (now() - t.measured_at)) / 60 as age_minutes,
            r.period_s
       from points p
       join lateral (
         select metrics, measured_at from device_telemetry
          where point_id = p.id and source = 'pi'
          order by measured_at desc limit 3) t on true
       left join lateral (
         select extract(epoch from (max(measured_at) - min(measured_at))) / nullif(count(*) - 1, 0) as period_s
           from (select measured_at from device_telemetry
                  where point_id = p.id and source = 'pi'
                  order by measured_at desc limit 10) recent) r on true
      where p.status = 'live'`
  );

  // Лятераль віддає до трьох проб на точку окремими рядками — збираємо їх
  // назад у пачку, найсвіжіша перша.
  const points = new Map();
  for (const row of rows) {
    if (!points.has(row.id)) points.set(row.id, { id: row.id, name: row.name, period_s: row.period_s, probes: [] });
    points.get(row.id).probes.push(row);
  }

  const out = [];
  for (const point of points.values()) {
    const probes = point.probes.sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at));
    const last = probes[0];
    // Проба застара — нічого не кажемо: про мовчазну точку вже сказав
    // checkPoints, і вісім алертів про її залізо були б тим самим удруге.
    if (Number(last.age_minutes) >= silenceLimit(point.period_s ? Number(point.period_s) : null)) continue;

    const m = last.metrics ?? {};
    const recent = probes.map((p) => p.metrics ?? {});
    for (const check of DEVICE_CHECKS) {
      const bad = Boolean(check.bad(m, recent));
      out.push({
        key: `${point.id}:${check.key}`,
        state: bad ? "bad" : "ok",
        text: bad
          ? `${check.icon} ${point.name}: ${check.down(m, recent)}`
          : `✅ ${point.name}: ${check.up(m)}`,
      });
    }

    const boot = rebootKey(probes);
    if (boot) out.push({ key: `${point.id}:${boot}`, once: true, text: `🔁 ${point.name}: точка перезавантажилась` });
  }
  return out;
}

// Що це було: лежала малина чи просто не було інтернету.
//
// Відповідь дає сама телеметрія, і вона однозначна. Малина не викидає проб
// при обриві: усе, що не пішло, лягає в state/telemetry.queue і доїжджає
// потім зі СВОЇМ measured_at. Тому в базі лишається два різні сліди:
//
//   мережа лежала    — ряд measured_at суцільний, дірки немає, але
//                      received_at у тих проб пізніший на весь час обриву;
//   малина лежала    — у measured_at дірка: міряти в цей час не було кому,
//                      і задним числом її вже ніхто не заповнить.
//
// Розрізняє їх `received_at`, який ми й так пишемо на кожен рядок. Третій
// випадок виходить сам собою: дірка є, а машина не перезавантажувалась —
// значить, система жила, а телеметрія мовчала. Це найгірший із трьох, бо
// означає, що щось зависло тихо, і його варто називати вголос.
//
// Вікно — 12 годин: довше мовчання класифікувати нема з чого, і тоді
// повідомлення лишається без пояснення, а не з вигаданим.
//
// Дірку від зависання телеметрії відрізняє аптайм — але порівнювати його
// треба ПО ОБИДВА БОКИ дірки, а не з її тривалістю. Перша версія брала
// аптайм останньої проби: варто було overseer подивитись на шість хвилин
// пізніше, ніж тривала пʼятихвилинна дірка, і аптайм машини, яка щойно
// завантажилась, уже переростав дірку — перезавантаження читалось як
// «телеметрія мовчала» (зловлено на тесті 24.09.2026).
//
// Правильне питання: чи міг аптайм дорости від того, що був ДО дірки, до
// того, що став ПІСЛЯ. Якщо машина не вимикалась, різниця аптаймів дорівнює
// різниці часу. Якщо менша — вона встигла злітати в нуль.
const OUTAGE_MIN_S = 180;    // менше трьох хвилин — це не «обрив», а ритм проб
// Годинника з батарейкою на платі немає: після знеструмлення час підхоплює
// fake-hwclock, і перші проби можуть поїхати на хвилину-другу. Дві хвилини
// допуску — щоб цей зсув не читався як перезавантаження.
const CLOCK_SLACK_S = 120;

export async function outageKind(pool, pointId) {
  // Якір — НАЙСВІЖІШИЙ розрив у ДОСТАВЦІ, а не найбільша дірка у вимірах.
  // Перша версія брала максимум за дванадцять годин і після трихвилинного
  // обриву написала «малина не працювала 10.3 год»: вона чесно знайшла нічне
  // вимкнення, про яке вранці вже повідомила. Питання ж не «яка найгірша
  // дірка за добу», а «що це зараз було» (знайшов власник, 25.09.2026).
  //
  // Рядок, який шукаємо, — перша проба, що доїхала ПІСЛЯ паузи. У ній є все
  // потрібне:
  //   outage_s — скільки часу від точки нічого не приходило (сам обрив);
  //   hole_s   — скільки часу ніхто нічого не МІРЯВ. Малина, що працює,
  //              міряє собі далі в чергу, і дірка тут дорівнює одному
  //              періоду; малина, що лежить, не міряє нічого, і дірка
  //              дорівнює обриву.
  //
  // Друга спроба ловила «свіжість» через received_at за останні пʼять
  // хвилин — і розсипалась, щойно overseer заглядав пізніше. Тепер вікна
  // немає взагалі: беремо останній розрив, хоч би коли ми на нього дивились.
  const { rows: [o] } = await pool.query(
    `with p as (
       select measured_at, received_at,
              (metrics->>'uptime_s')::float as uptime,
              lag(received_at) over w as prev_recv,
              lag(measured_at) over w as prev_meas,
              lag((metrics->>'uptime_s')::float) over w as prev_uptime
         from device_telemetry
        where point_id = $1 and source = 'pi' and received_at > now() - interval '12 hours'
       window w as (order by received_at, measured_at))
     select extract(epoch from (received_at - prev_recv)) as outage_s,
            extract(epoch from (measured_at - prev_meas)) as hole_s,
            uptime, prev_uptime
       from p
      where prev_recv is not null
        and received_at - prev_recv >= make_interval(secs => $2)
      order by received_at desc, measured_at desc
      limit 1`,
    [pointId, OUTAGE_MIN_S]
  );
  if (!o) return null;

  const outage = Number(o.outage_s), hole = Number(o.hole_s);
  if (hole >= OUTAGE_MIN_S) {
    const after = Number(o.uptime), before = Number(o.prev_uptime);
    const grew = Number.isFinite(after) && Number.isFinite(before)
      ? after >= before + hole - CLOCK_SLACK_S
      : Number.isFinite(after) && after >= hole;
    return grew
      ? `малина працювала, але не слала проб ${human(hole / 60)} — щось зависало`
      : `малина не працювала ${human(hole / 60)}`;
  }
  return `не було інтернету ${human(outage / 60)}, малина працювала`;
}

// Точка «жива», поки шле телеметрію. Порівнюємо з last_seen_at, який
// оновлює api на кожен пінг малини.
export async function checkPoints(pool) {
  const { rows } = await pool.query(POINTS_SQL);
  return rows.map((p) => {
    const limit = silenceLimit(p.period_s ? Number(p.period_s) : null);
    return {
      id: p.id,
      name: p.name,
      limitMinutes: limit,
      state: p.last_seen_at && p.silent_minutes < limit ? "ok" : "silent",
      silentFor: p.last_seen_at ? human(p.silent_minutes) : "від самого початку",
    };
  });
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
