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
# не змінились. Маніфести всіх воркспейсів потрібні, бо lock описує монорепо
# цілком — без них bun не зіставить його з деревом.
COPY package.json bun.lock ./
COPY api/package.json ./api/
COPY ws/package.json ./ws/
COPY checkbox/package.json ./checkbox/
COPY overseer/package.json ./overseer/
COPY pos/package.json ./pos/
COPY client/package.json ./client/

# --frozen-lockfile: збірка не має права тихо підняти версію, якої немає в
# lock. --filter: ставимо залежності лише потрібного сервісу.
RUN bun install --frozen-lockfile --production --filter "./${SVC}"

COPY ${SVC}/ ./${SVC}/
WORKDIR /app/${SVC}
ENV NODE_ENV=production
CMD ["bun", "src/index.js"]
