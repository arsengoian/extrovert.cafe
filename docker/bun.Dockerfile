# Один Dockerfile на всі сервіси бекенда: різниця лише в аргументі SVC.
#
# Bun замість Node (20.09.2026, docs/services.md §2): один інструмент і як
# рантайм, і як менеджер пакетів, тож в образі немає npm, а lock у монорепо
# один на всіх.
# Версія закріплена точно, і це не педантизм: рухомий `1-alpine` на Hub
# означає найсвіжіший 1.x, а `docker build` без `--pull` бере те, що лежить
# у локальному кеші, — дві машини зібрали б різні образи з того самого
# Dockerfile. Тут має стояти рівно та версія, що й у розробника на машині;
# піднімати — окремим комітом, разом із `bun upgrade`.
# Варіанти тегів: alpine = musl (наш вибір, у нас чистий JS), slim/debian =
# glibc, якщо колись знадобиться нативний модуль.
FROM oven/bun:1.4.2-alpine
ARG SVC
WORKDIR /app

# Спершу маніфести й lock: шар із залежностями не перезбирається, поки вони
# не змінились. Маніфести потрібні лише два — спільної бібліотеки й самого
# сервіса: bun із --filter бере з монорепо потрібну гілку й не вимагає решти
# (перевірено збіркою 21.09.2026). Воркспейси фронтендів сюди й не поїхали б
# за змістом: client і redirect живуть на Cloudflare Workers, pos — на
# малині, у бекендному образі їм немає що робити.
COPY package.json bun.lock ./
COPY backend/lib/package.json ./backend/lib/
COPY backend/${SVC}/package.json ./backend/${SVC}/

# --frozen-lockfile: збірка не має права тихо підняти версію, якої немає в
# lock. --filter: ставимо залежності лише потрібного сервісу.
RUN bun install --frozen-lockfile --production --filter "./backend/${SVC}"

# Спільна бібліотека (Postgres, Redis, outbox, логер) їде з кожним сервісом:
# у монорепо вона не публікується, тому в образі має бути її код, а не лише
# запис у lock.
COPY backend/lib/ ./backend/lib/
COPY backend/${SVC}/ ./backend/${SVC}/
# pg_dump для щоденного бекапу бази (scheduler/jobs/backup.js) — лише в
# образі scheduler. Мажорна версія — як у postgres у compose (16): старіший
# клієнт відмовиться дампити новіший сервер.
RUN if [ "$SVC" = "scheduler" ]; then apk add --no-cache postgresql16-client; fi
WORKDIR /app/backend/${SVC}
ENV NODE_ENV=production
CMD ["bun", "src/index.js"]
