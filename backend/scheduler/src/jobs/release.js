// «На бакеті новий реліз малини» — подія в канал кожної живої точки.
//
// CI не має як достукатись до точки: вона за роутером у локальній мережі
// (docs/raspberry-pi.md §3). Зате точка сама тримає ws до прода — тим самим
// каналом, яким приїжджає bonus_ready. Тож замість того, щоб чекати кола
// опитування, кажемо кіоску «є нове», він торкається `state/check-now`, і
// апдейтер прокидається з очікування за пʼять секунд.
//
// Опитування маніфесту лишається бекапом на випадок, коли ws лежить, а
// HTTP працює (docs/raspberry-pi.md, «Точку не можна штовхнути ззовні»).
//
// Чому сторожем працює планувальник, а не крок у CI: жодних секретів і
// жодного нового ендпоїнта, і працює воно для БУДЬ-ЯКОГО способу
// публікації — навіть якщо маніфест колись покладуть повз GitHub Actions.
import { enqueue } from "@extrovert/lib/outbox.js";

const MANIFEST_URL = process.env.PI_MANIFEST_URL
  || "https://pos.extrovert.cafe/releases/pi/manifest.json";

const SEEN_KEY = "pi:release:seen";
const ETAG_KEY = "pi:release:etag";

export async function watchPiRelease({ pool, redis, log }) {
  const etag = await redis.get(ETAG_KEY).catch(() => null);
  let res;
  try {
    res = await fetch(MANIFEST_URL, {
      headers: etag ? { "if-none-match": etag } : {},
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // Бакет недоступний — не подія. Точка все одно питає його сама.
    log?.warn({ err: e.message }, "маніфест малини не прочитався");
    return {};
  }
  if (res.status === 304) return {};
  if (!res.ok) {
    log?.warn({ status: res.status }, "маніфест малини віддав не 200");
    return {};
  }

  const body = await res.json().catch(() => null);
  const release = body?.release;
  if (!release || typeof release !== "string") return {};

  const next = res.headers.get("etag");
  if (next) await redis.set(ETAG_KEY, next).catch(() => {});

  const seen = await redis.get(SEEN_KEY).catch(() => null);
  if (seen === release) return {};
  await redis.set(SEEN_KEY, release).catch(() => {});

  // Перший запуск із порожнім Redis нічого не розсилає: інакше кожен деплой
  // самого планувальника гнав би всі точки перевіряти оновлення, яке в них
  // уже стоїть. Той самий принцип, що в overseer з алертами на зміну стану.
  if (seen === null) {
    log?.info({ release }, "запамʼятав поточний реліз малини, точок не турбую");
    return {};
  }

  const { rows } = await pool.query("select id from points where status = 'live'");
  if (!rows.length) return {};

  const client = await pool.connect();
  try {
    for (const p of rows) await enqueue(client, `point:${p.id}`, "pi_release", { release });
  } finally {
    client.release();
  }
  return { done: `новий реліз малини ${release} — сказав ${rows.length} точкам`, extra: { release } };
}
