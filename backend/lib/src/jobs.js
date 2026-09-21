// Робота за розкладом: блокування в Redis і курсор у Postgres.
//
// Блокування потрібне не «про всяк випадок»: дві копії scheduler підняти
// легко (рестарт, деплой, помилка в compose), і нічна синхронізація
// довідника НП у двох примірниках — це подвійний трафік і гонка за ті самі
// рядки. Ключ живе трохи довше за саму роботу й сам протухає, тож зависла
// копія не блокує чергу назавжди.
export async function withLock(redis, name, ttlMs, fn) {
  const key = `lock:${name}`;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const got = await redis.set(key, token, "PX", ttlMs, "NX");
  if (!got) return { skipped: true };
  try {
    return { skipped: false, result: await fn() };
  } finally {
    // Знімаємо лише свій ключ: чужий міг зʼявитись, якщо наш устиг протухнути.
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    await redis.eval(script, 1, key, token).catch(() => {});
  }
}

export async function readCursor(pool, name) {
  const { rows } = await pool.query("select cursor_at, run_at, last_error from sync_cursors where name = $1", [name]);
  return rows[0] ?? null;
}

export async function writeCursor(pool, name, { cursorAt = null, error = null } = {}) {
  await pool.query(
    `insert into sync_cursors (name, cursor_at, run_at, last_error)
     values ($1, $2, now(), $3)
     on conflict (name) do update
       set cursor_at = coalesce(excluded.cursor_at, sync_cursors.cursor_at),
           run_at = excluded.run_at,
           last_error = excluded.last_error`,
    [name, cursorAt, error]
  );
}

// Проста петля: робота крутиться, поки процес живий, і пауза береться
// після завершення, а не паралельно — дві копії однієї роботи не
// накладаються навіть якщо вона затяглась.
//
// Повертає асинхронний stop(): він чекає, поки поточний прохід допрацює.
// Це і є вся «плавна зупинка» фонового сервіса — робота, яку вбили
// посередині, лишає по собі взяте блокування й недописаний курсор, тобто
// наступний запуск або дублює зроблене, або пропускає його.
export function every(ms, name, fn, log) {
  let stopped = false;
  // Пауза має вміти прокидатись: інакше зупинка scheduler чекала б до
  // кінця нічного інтервалу, а докер стільки не чекає.
  let wake = () => {};

  const loop = async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        await fn();
      } catch (e) {
        log?.error(`робота ${name} впала`, e);
      }
      if (stopped) break;
      const wait = Math.max(0, ms - (Date.now() - started));
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, wait);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  };

  const done = loop();
  return async () => {
    stopped = true;
    wake();
    await done;
  };
}
