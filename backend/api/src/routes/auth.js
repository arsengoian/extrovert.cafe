// Вхід і оновлення сесії (docs/services.md §3).
//
// Гравець входить посиланням із пошти: пароля немає, щоразу приходить лист
// (mail/login.js). Google — окремим кроком. Девелоперський вхід існує лише
// там, де DEV (env.js), — у проді цих роутів просто немає.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { one, query, tx } from "../db.js";
import { signToken } from "../auth.js";
import { DEV } from "../env.js";
import { fail } from "../errors.js";
import { generateNickname } from "../nickname.js";
import { loginEmail } from "../mail/login.js";
import { mailConfigured, sendMail } from "../mail/mailgun.js";
import { clearCookie, cookieFrom, createSession, dropSession, readSession, sessionCookie, touchSession } from "../session.js";
import { redisClient } from "@extrovert/lib/redis.js";

const APP_ORIGIN = process.env.APP_ORIGIN || "https://extrovert.cafe";
const API_ORIGIN = process.env.API_ORIGIN || "https://api.extrovert.cafe";
const LINK_TTL_MIN = 15;
// Не частіше раза на хвилину й не більше п'яти листів на годину на адресу,
// двадцяти — з однієї IP. Без меж форма входу стає кнопкою «засипати чужу
// скриньку листами» за наш рахунок у Mailgun.
const LIMITS = { cooldownS: 60, perEmailHour: 5, perIpHour: 20 };

const hash = (token) => createHash("sha256").update(token).digest();
// Груба перевірка форми: справжню скаже тільки лист, що дійшов.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Куди повернути після входу: головна або бонус із QR кіоска (/b/<токен>),
// який людина відкрила ще до входу. Лише ці шляхи — інакше посилання з
// листа стало б відкритим редиректом.
const NEXT = /^\/(b\/[A-Za-z0-9_-]{1,128})?$/;
// За Caddy справжня адреса — у X-Real-IP (він її переписує, підробити
// ззовні не вийде); локально Caddy немає, і там це неважливо. Не адреса —
// null, щоб сміття в заголовку не валило запит на колонці inet.
const clientIp = (req) => {
  const ip = String(req.headers["x-real-ip"] || req.ip || "");
  return isIP(ip) ? ip : null;
};

async function issue(reply, user) {
  const { id, ttl } = await createSession(user.id);
  await query("update users set last_seen_at = now() where id = $1", [user.id]);
  reply.header("set-cookie", sessionCookie(id, ttl));
  return {
    token: signToken(`user:${user.id}`, "player"),
    user: { id: user.id, nickname: user.nickname },
  };
}

const redis = redisClient();

// ── вхід із пошти в іншому браузері ────────────────────────────────────
// Gmail відкриває посилання у своєму вікні, а на iPhone воно не ділить
// сховище з Safari: людина «входила» всередині Gmail, а там, де просила
// лист, лишалась поза акаунтом (власник, 27.09.2026). Тому вкладка-прохач
// отримує секрет очікування і чекає: посилання, відкрите будь-де й
// підтверджене людиною, дає їй власну сесію (docs/services.md §3).
//
// Чекає вона довгим запитом, а не опитуванням: сервер тримає запит до
// WAIT_S секунд і відпускає одразу, щойно прийде сигнал із Redis. Сигнал
// і база — два шляхи до тієї самої правди: сигнал будить, а що саме
// сталось, щоразу читаємо з login_links.
const WAIT_S = 20;
const waiters = new Map();          // hex(wait_hash) → Set<wake>
let sub = null;
function listen() {
  if (sub) return;
  sub = redisClient();
  sub.psubscribe("login:wake:*").catch(() => {});
  sub.on("pmessage", (_p, channel) => {
    const set = waiters.get(channel.slice("login:wake:".length));
    if (set) for (const wake of set) wake();
  });
}
function nap(key, ms) {
  listen();
  return new Promise((done) => {
    const set = waiters.get(key) ?? new Set();
    waiters.set(key, set);
    const wake = () => { clearTimeout(t); set.delete(wake); if (!set.size) waiters.delete(key); done(); };
    // Раз на кілька секунд перечитуємо базу й без сигналу: загублене
    // повідомлення не має коштувати людині входу.
    const t = setTimeout(wake, ms);
    set.add(wake);
  });
}
const wakeWaiter = (waitHash) => redis.publish(`login:wake:${waitHash.toString("hex")}`, "1").catch(() => {});

// «Chrome · Android» із user-agent — щоб людина впізнала на екрані «Це ти
// входиш?» свій пристрій. Точність не потрібна: досить, щоб чужий телефон
// не виглядав як свій ноутбук.
function deviceOf(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /OPR\//.test(ua) ? "Opera" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" · ") || "невідомий пристрій";
}

// ── вхід через Google ───────────────────────────────────────────────────
//
// Звичайний authorization code flow, без бібліотек: два запити до Google і
// один рядок у Redis. id_token не розбираємо — беремо профіль із userinfo
// по access-токену: менше коду й жодної перевірки підписів вручну.
//
// Адреса повернення будується з API_ORIGIN, тому локальний і продовий
// входи різняться лише тим, що прописано в консолі Google:
//   http://localhost:3001/api/v1/auth/google/callback
//   https://api.extrovert.cafe/api/v1/auth/google/callback
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
// API_ORIGIN — публічна адреса api (туди ж ідуть вебхуки mono й telegram),
// і локально вона лишається продовою. Тому адресу повернення можна
// перекрити окремо: OAUTH_ORIGIN=http://localhost:3001 у .env розробника.
const googleRedirect = () => `${process.env.OAUTH_ORIGIN || API_ORIGIN}/api/v1/auth/google/callback`;
const stateKey = (state) => `oauth:google:${state}`;

// Гравець за підтвердженою поштою. Лист дійшов і посилання відкрили —
// отже, скринька належить цій людині, і акаунт із тією самою поштою (скажімо,
// заведений через Google) — її ж. Замок на адресу: два посилання, відкриті
// одночасно, не мають завести два акаунти.
function userByEmail(email) {
  return tx(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`login:${email}`]);
    const linked = await client.query(
      `select u.id, u.nickname from user_identities i join users u on u.id = i.user_id
        where i.provider = 'email' and i.subject = $1 and u.deleted_at is null`,
      [email]
    );
    if (linked.rows[0]) return linked.rows[0];

    const same = await client.query(
      "select id, nickname from users where email = $1 and deleted_at is null order by created_at limit 1",
      [email]
    );
    const user = same.rows[0] ?? (await client.query(
      "insert into users (id, nickname, email) values ($1, $2, $3) returning id, nickname",
      [randomUUID(), await generateNickname(), email]
    )).rows[0];
    await client.query(
      "insert into user_identities (user_id, provider, subject) values ($1, 'email', $2) on conflict (provider, subject) do nothing",
      [user.id, email]
    );
    return user;
  });
}

export default async function routes(app) {
  // Лист із посиланням. Відповідь однакова, є акаунт чи ні: новий гравець
  // заводиться тим самим листом, тож перевіряти «чи зареєстрована пошта»
  // тут нема чого — і нема що з цього вивідати.
  app.post("/auth/email", async (req) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) fail(400, "bad_email");
    const next = typeof req.body?.next === "string" && NEXT.test(req.body.next) ? req.body.next : null;
    const ip = clientIp(req);
    if (!mailConfigured() && !DEV) fail(503, "mail_not_configured");

    const recent = await one(
      `select
         count(*) filter (where email = $1 and created_at > now() - make_interval(secs => $3))::int as cooldown,
         count(*) filter (where email = $1)::int as per_email,
         count(*) filter (where ip = $2)::int as per_ip
       from login_links
       where created_at > now() - interval '1 hour' and (email = $1 or ip = $2)`,
      [email, ip, LIMITS.cooldownS]
    );
    if (recent.cooldown > 0) fail(429, "too_soon", { retry_after: LIMITS.cooldownS });
    if (recent.per_email >= LIMITS.perEmailHour || recent.per_ip >= LIMITS.perIpHour) fail(429, "too_many");

    // У базі лише хеш: посилання — це ключ від акаунта, і дамп таблиці не
    // має давати змогу ним скористатись. Так само й секрет очікування: його
    // знає лише вкладка, яка просила лист.
    const token = randomBytes(32).toString("base64url");
    const wait = randomBytes(24).toString("base64url");
    await query(
      `insert into login_links (token_hash, email, next_path, expires_at, ip, user_agent, wait_hash)
       values ($1, $2, $3, now() + make_interval(mins => $4), $5, $6, $7)`,
      [hash(token), email, next, LINK_TTL_MIN, ip, String(req.headers["user-agent"] ?? "").slice(0, 300), hash(wait)]
    );
    // Прибирання дорогою: рядки живуть добу, для лімітів і розбору скарг
    // цього досить, а окрема робота в scheduler під це — зайва.
    await query("delete from login_links where created_at < now() - interval '1 day'");

    // Токен у фрагменті (#), а не в шляху чи query: фрагмент не їде на
    // сервер, тож не осідає в логах воркера, а поштові сканери, які
    // «перевіряють» посилання GET-запитом, нічого не витрачають — вхід
    // відбувається лише тоді, коли сторінка сама надішле токен.
    const link = `${APP_ORIGIN}/login#${token}`;
    if (!mailConfigured()) {
      req.log.warn({ link }, "пошта не налаштована — посилання для входу лише тут, у лозі");
    } else {
      try {
        await sendMail({ to: email, tag: "login", ...loginEmail({ link, minutes: LINK_TTL_MIN, origin: APP_ORIGIN }) });
      } catch (e) {
        // Лист не пішов — рядок прибираємо, щоб хвилинна пауза не заважала
        // спробувати ще раз.
        await query("delete from login_links where token_hash = $1", [hash(token)]);
        req.log.error({ err: e.message }, "лист для входу не відправився");
        fail(502, "mail_failed");
      }
    }
    return { ok: true, cooldown: LIMITS.cooldownS, minutes: LINK_TTL_MIN, wait };
  });

  // Що саме підтверджує людина, відкривши посилання в іншому браузері:
  // яка пошта й з якого пристрою просили вхід. Посилання не витрачає.
  // waiting: false — прохання старе (до 27.09.2026) або вкладки-прохача не
  // було: тоді сторінка просто входить, як раніше.
  app.post("/auth/email/peek", async (req) => {
    const token = String(req.body?.token ?? "");
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(400, "bad_token");
    const link = await one(
      `select email, user_agent, created_at, wait_hash is not null as waiting
         from login_links where token_hash = $1 and used_at is null and expires_at > now()`,
      [hash(token)]
    );
    if (!link) fail(410, "link_expired");
    return { email: link.email, device: deviceOf(link.user_agent ?? ""), requested_at: link.created_at, waiting: link.waiting };
  });

  // «Ні, не я»: посилання згоряє, і вкладка-прохач, якщо вона чужа,
  // дізнається, що входу не буде.
  app.post("/auth/email/reject", async (req) => {
    const token = String(req.body?.token ?? "");
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(400, "bad_token");
    const link = await one(
      `update login_links set used_at = now(), rejected_at = now()
        where token_hash = $1 and used_at is null returning wait_hash`,
      [hash(token)]
    );
    if (link?.wait_hash) await wakeWaiter(link.wait_hash);
    return { ok: true };
  });

  // Вкладка-прохач чекає підтвердження. Відповідь: сесія (як у verify),
  // { pending: true } — ще не підтвердили, спитай знову, або 410 —
  // посилання відхилили чи воно застаріло.
  app.post("/auth/email/wait", async (req, reply) => {
    const wait = String(req.body?.wait ?? "");
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(wait)) fail(400, "bad_wait");
    const h = hash(wait);
    const key = h.toString("hex");
    const until = Date.now() + WAIT_S * 1000;
    for (;;) {
      const claimed = await one(
        `update login_links set claimed_at = now()
          where wait_hash = $1 and approved_at is not null and claimed_at is null
          returning email, next_path`,
        [h]
      );
      if (claimed) {
        const user = await userByEmail(claimed.email);
        return { ...(await issue(reply, user)), next: claimed.next_path ?? "/" };
      }
      const link = await one(
        "select rejected_at, claimed_at, expires_at > now() as alive from login_links where wait_hash = $1",
        [h]
      );
      if (!link || link.rejected_at || link.claimed_at || (!link.alive)) fail(410, link?.rejected_at ? "login_rejected" : "link_expired");
      const left = until - Date.now();
      if (left <= 0) return { pending: true };
      await nap(key, Math.min(left, 5000));
    }
  });

  // Сторінка /login бере токен із фрагмента й надсилає сюди. Одноразовий:
  // перше ж відкриття гасить посилання.
  app.get("/auth/google", async (req, reply) => {
    if (!googleReady()) fail(503, "google_not_configured");
    const next = NEXT.test(String(req.query?.next ?? "/")) ? String(req.query?.next ?? "/") : "/";
    const state = randomBytes(16).toString("hex");
    await redis.set(stateKey(state), next, "EX", 600);
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirect(),
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    }).toString();
    return reply.redirect(url.toString(), 302);
  });

  app.get("/auth/google/callback", async (req, reply) => {
    // Помилку не показуємо сторінкою api: людина має повернутись у
    // застосунок, а він уже скаже, що вхід не вдався.
    const back = (error) => reply.redirect(`${APP_ORIGIN}/${error ? `?login=${error}` : ""}`, 302);
    if (!googleReady()) return back("google_off");
    const state = String(req.query?.state ?? "");
    const code = String(req.query?.code ?? "");
    if (!state || !code) return back("google_cancelled");

    const next = await redis.get(stateKey(state));
    if (next === null) return back("google_expired");
    await redis.del(stateKey(state));

    try {
      const token = await fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: googleRedirect(),
          grant_type: "authorization_code",
        }),
      }).then((r) => r.json());
      if (!token.access_token) throw new Error(token.error_description || token.error || "немає access_token");

      const profile = await fetch(GOOGLE_USERINFO, {
        headers: { authorization: `Bearer ${token.access_token}` },
      }).then((r) => r.json());
      // Непідтверджена пошта — це не доказ володіння скринькою, а наш
      // акаунт прив'язаний саме до неї.
      if (!profile.email || profile.email_verified === false) return back("google_unverified");

      const user = await userByEmail(String(profile.email).trim().toLowerCase());
      await issue(reply, user);
      return reply.redirect(`${APP_ORIGIN}${next}`, 302);
    } catch (e) {
      req.log?.warn?.({ err: e.message }, "вхід через Google не вдався");
      return back("google_failed");
    }
  });

  app.post("/auth/email/verify", async (req, reply) => {
    const token = String(req.body?.token ?? "");
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(400, "bad_token");
    // Відкрите посилання — це й підтвердження для вкладки-прохача, якщо
    // вона є: вона забере власну сесію через /auth/email/wait.
    const link = await one(
      `update login_links set used_at = now(), approved_at = case when wait_hash is null then null else now() end
        where token_hash = $1 and used_at is null and expires_at > now()
        returning email, next_path, wait_hash`,
      [hash(token)]
    );
    if (!link) fail(410, "link_expired");
    const user = await userByEmail(link.email);
    const session = await issue(reply, user);
    if (link.wait_hash) await wakeWaiter(link.wait_hash);
    return { ...session, next: link.next_path ?? "/", waiting: Boolean(link.wait_hash) };
  });

  // Девелоперський вхід: створює гравця з metadata.dev = true, щоб скрипти
  // розробника мали право його чіпати (roadmap, крок 0-біс).
  app.post("/auth/dev", async (req, reply) => {
    if (!DEV) return reply.code(404).send({ error: "not_found" });
    const nickname = (req.body?.nickname || "").trim() || (await generateNickname());

    const existing = await one("select * from users where nickname = $1 and deleted_at is null", [nickname]);
    // Нікнейм міг лишитись за видаленим акаунтом: увійти в нього не можна,
    // але й зайняти його ім'я теж — тоді видаємо нове, замість падати на
    // унікальному індексі.
    const free = existing
      ? nickname
      : (await one("select 1 from users where nickname = $1", [nickname]))
        ? await generateNickname()
        : nickname;

    const user =
      existing ||
      (await one(
        `insert into users (id, nickname, metadata, consent_at, terms_version)
         values ($1, $2, '{"dev": true}'::jsonb, now(), 'dev')
         returning *`,
        [randomUUID(), free]
      ));

    return issue(reply, user);
  });

  // Обмін куки на свіжий access-токен. Клієнт кличе це сам, коли впіймав
  // 401 чи відкрився: для гравця оновлення сесії має бути непомітним. Кожне
  // оновлення ще й продовжує сесію (session.js) — вилогінює лише пів року
  // тиші.
  app.post("/auth/refresh", async (req, reply) => {
    const sid = cookieFrom(req);
    const session = await readSession(sid);
    if (!session || session.admin) {
      reply.header("set-cookie", clearCookie());
      return reply.code(401).send({ error: "no_session" });
    }
    // Видалений акаунт не оновлює сесію: інакше інші пристрої лишались би
    // в ньому ще пів року.
    const user = await one("select id, nickname from users where id = $1 and deleted_at is null", [session.user]);
    if (!user) {
      await dropSession(sid);
      reply.header("set-cookie", clearCookie());
      return reply.code(401).send({ error: "no_such_user" });
    }
    const ttl = await touchSession(sid, session);
    if (!ttl) {
      reply.header("set-cookie", clearCookie());
      return reply.code(401).send({ error: "no_session" });
    }
    // «Остання поява» в адмінці: колонка була, писати її не було кому, тож
    // усі гравці там значились як «не заходив» (знайдено 23.09.2026).
    // Рефреш — найдешевше місце: клієнт ходить сюди що чверть години
    // роботи й жодного разу, поки застосунок закритий.
    await query("update users set last_seen_at = now() where id = $1", [user.id]);
    reply.header("set-cookie", sessionCookie(sid, ttl));
    return {
      token: signToken(`user:${user.id}`, "player"),
      user: { id: user.id, nickname: user.nickname },
    };
  });

  app.post("/auth/logout", async (req, reply) => {
    await dropSession(cookieFrom(req));
    reply.header("set-cookie", clearCookie());
    return { ok: true };
  });
}
