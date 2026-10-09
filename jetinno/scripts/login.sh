#!/usr/bin/env bash
# Вхід у портал Jetinno з контейнера стеку й синхронізація куки у файл.
#
#   bash jetinno/scripts/login.sh          (або make d-jetinno-login)
#
# Чому з контейнера: solveCaptcha у portal.js ходить у ddddocr, а той
# резолвиться лише в docker-мережі стеку; там же Redis. Тому вхід робимо
# всередині сервісу (login() кладе сесію в Redis), а потім переносимо куку в
# jetinno/cookie.txt — файл, який читають решта скриптів jetinno/scripts/*
# (вони бігають на хості й до ddddocr доступу не мають).
#
# Сервіси не монтують код — він у образі. Після змін у коді онови образ:
#   docker compose up -d --build api
#
# Капчу розв'язує solveCaptcha у portal.js (код власника); Claude у неї не
# втручається.
set -euo pipefail
cd "$(dirname "$0")/../.."
SVC="${JETINNO_LOGIN_SVC:-api}"   # сервіс стеку з @extrovert/lib і доступом до ddddocr

# 1. Вхід усередині контейнера → сесія в Redis (jetinno:session).
docker compose exec -T "$SVC" bun -e '
  const m = await import("@extrovert/lib/jetinno/portal.js").catch(() => null);
  if (!m) { console.error("образ застарів — онови: docker compose up -d --build <сервіс>"); process.exit(2); }
  await m.login({});
  console.log("вхід ок — сесія в Redis");
  // Явний вихід: login() лишає відкритим конект ioredis, інакше bun -e
  // висить, а з ним і docker compose exec.
  process.exit(0);
'

# 2. Переносимо куку з Redis у файл для host-скриптів.
cookie=$(docker compose exec -T redis redis-cli GET jetinno:session | tr -d '\r')
[ -n "$cookie" ] || { echo "✗ у Redis немає jetinno:session — сесію не збережено" >&2; exit 1; }
printf '# Згенеровано jetinno/scripts/login.sh з Redis (jetinno:session).\n# Рядки з # ігноруються рештою скриптів.\n%s\n' "$cookie" > jetinno/cookie.txt
echo "✓ cookie.txt синхронізовано з Redis"
