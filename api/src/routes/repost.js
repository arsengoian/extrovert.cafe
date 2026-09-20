// Репост у соцмережі: гравець ділиться персональним посиланням, монети
// падають після першого чужого переходу за ним (екран «Репост у соцмережі»).
//
// Ліміти з economy §2.4: не частіше разу на 10 днів, максимум 5 за акаунт.
// Перевіряються двічі — коли видаємо посилання і коли зараховуємо перехід:
// між цими двома моментами минають дні, і стан за цей час змінюється.
import { many, one, query, tx } from "../db.js";
import { requireUser, userFromRequest } from "../auth.js";
import { economy } from "../economy.js";
import { notifyPlant } from "../notify.js";

const R = economy.repost;
// Домен застосунку — конфіг оточення, а не економіка: локально посилання
// має вести на дев-сервер, інакше клік нікуди не дійде.
const APP_ORIGIN = process.env.APP_ORIGIN || "https://extrovert.cafe";
const DAY = 24 * 60 * 60 * 1000;

// Слаг у посиланні — нікнейм гравця: саме його людина бачить у сторіс, і
// саме він робить посилання впізнаваним. Якщо нікнейм уже стоїть у чиємусь
// токені (гравець перейменувався, а ім'я перехопили), додаємо суфікс:
// токен мусить лишатись унікальним, інакше перехід зарахується не тому.
async function freeToken(nickname) {
  for (const suffix of ["", "-2", "-3", "-4", "-5"]) {
    const candidate = `${nickname}${suffix}`;
    const taken = await one("select 1 from repost_verifications where redirect_token = $1", [candidate]);
    if (!taken) return candidate;
  }
  return `${nickname}-${Math.random().toString(36).slice(2, 7)}`;
}

function referrerHost(referer) {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.replace(/^www\./, "");
    const own = new URL(APP_ORIGIN).hostname.replace(/^www\./, "");
    return host === own ? null : host;
  } catch {
    return null;
  }
}

function status(rows) {
  const verified = rows.filter((r) => r.verified_at);
  // Останній зарахований — не обовʼязково останній створений: посилання
  // могли видати підряд, а спрацювати вони можуть у будь-якому порядку.
  const last = verified.length
    ? verified.map((r) => r.verified_at).sort((a, b) => new Date(a) - new Date(b)).at(-1)
    : null;
  const nextAt = last ? new Date(new Date(last).getTime() + R.min_days_between * DAY) : null;
  const waiting = nextAt && nextAt > new Date() ? nextAt : null;
  return {
    counted: verified.length,
    max: R.max_per_account,
    reward: R.coins,
    min_days_between: R.min_days_between,
    next_available_at: waiting,
    days_left: waiting ? Math.ceil((waiting - new Date()) / DAY) : 0,
    limit_reached: verified.length >= R.max_per_account,
  };
}

export default async function routes(app) {
  // Стан екрана + посилання. Посилання створюється ліниво: поки гравець не
  // відкрив екран, зайвий рядок у таблиці нікому не потрібен.
  app.get("/repost", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const rows = await many(
      `select id, redirect_token, clicked_at, verified_at, coins_awarded, created_at
         from repost_verifications where user_id = $1 order by created_at desc`,
      [user.id]
    );
    const state = status(rows);

    let token = rows.find((r) => !r.verified_at)?.redirect_token ?? null;
    if (!token && !state.limit_reached) {
      const me = await one("select nickname from users where id = $1", [user.id]);
      token = await freeToken(me.nickname);
      await query("insert into repost_verifications (user_id, redirect_token) values ($1, $2)", [user.id, token]);
    }

    return { ...state, token, link: token ? `${APP_ORIGIN}/r/${token}` : null };
  });

  // Публічний перехід за посиланням: сюди стукає сторінка /r/<token>.
  // Відповідь однакова для всіх випадків — хто перейшов, не має дізнаватись
  // ні скільки в гравця репостів, ні чи зарахувався саме його клік.
  app.post("/repost/visit/:token", async (req, reply) => {
    const token = String(req.params.token ?? "");
    const row = await one(
      `select id, user_id, verified_at from repost_verifications where redirect_token = $1`,
      [token]
    );
    if (!row) return { ok: true };

    // Власний перехід не рахуємо: інакше «репост» робиться в один тап.
    const visitor = userFromRequest(req);
    const self = visitor?.id === row.user_id;

    // Мережу беремо з Referer — і лише чужу: перехід із самого застосунку
    // (гравець перевіряє власне посилання) нічого про соцмережу не каже.
    const network = referrerHost(req.headers.referer);
    await query(
      "update repost_verifications set clicked_at = coalesce(clicked_at, now()), network = coalesce(network, $2) where id = $1",
      [row.id, network]
    );
    if (row.verified_at || self) return { ok: true };

    // Ліміти перевіряємо всередині транзакції разом із нарахуванням:
    // два переходи в одну секунду не мають дати дві винагороди.
    await tx(async (client) => {
      const { rows: locked } = await client.query(
        "select verified_at from repost_verifications where id = $1 for update",
        [row.id]
      );
      if (locked[0]?.verified_at) return;

      const { rows: done } = await client.query(
        `select verified_at from repost_verifications
          where user_id = $1 and verified_at is not null order by verified_at desc`,
        [row.user_id]
      );
      if (done.length >= R.max_per_account) return;
      if (done[0] && Date.now() - new Date(done[0].verified_at).getTime() < R.min_days_between * DAY) return;

      await client.query(
        "update repost_verifications set verified_at = now(), coins_awarded = $2 where id = $1",
        [row.id, R.coins]
      );
      await client.query("update users set coins_silver = coins_silver + $2 where id = $1", [row.user_id, R.coins]);
      await client.query(
        `insert into ledger_entries (user_id, delta_silver, reason, meta) values ($1, $2, 'repost', $3)`,
        [row.user_id, R.coins, { repost_id: row.id, network }]
      );
      await notifyPlant(row.user_id, `Хтось перейшов за твоїм посиланням — нараховано ${R.coins} срібних за репост.`, { client });
    });

    return { ok: true };
  });
}
