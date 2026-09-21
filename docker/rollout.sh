#!/usr/bin/env bash
# Викочування нової версії на сервері.
#
# Запускається не на сервері, а З сервера через stdin:
#   ssh root@host -p 2222 'bash -s' -- <tag> < docker/rollout.sh
# Так на дроплеті не зʼявляється ще один файл, який колись розійдеться з
# репозиторієм (docs/deploy.md §2.3).
#
# Головна ідея — перемикання без розриву. Сервіси за проксі не публікують
# портів, тому поруч зі старим контейнером можна підняти новий, дочекатись
# його healthcheck, і лише тоді погасити старий. Caddy перепитує DNS докера
# кожні дві секунди, тож трафік переходить сам; старому контейнеру SIGTERM
# дає 30 секунд доробити те, що він уже взяв (backend/lib/src/shutdown.js).
set -euo pipefail

TAG="${1:?передай тег образу}"
DIR="${DIR:-/opt/extrovert}"
GRACE="${GRACE:-30}"          # стільки ж, скільки stop_grace_period у compose
WAIT_HEALTHY="${WAIT_HEALTHY:-90}"

# Сервіси, які перемикаються без розриву: вони за caddy і без публічних портів.
ROLLING="api ws checkbox"
# Решта — звичайний перезапуск: у них або немає трафіку ззовні (фонові
# роботи), або є порт хоста, тобто двох копій одночасно бути не може.
PLAIN="scheduler overseer caddy glitchtip glitchtip-worker"

cd "$DIR"

echo "── тег $TAG"
# Тег лишається в .env, щоб будь-який `docker compose` на сервері бачив ту
# саму версію, що й викотили. Інакше ручний `up -d` мовчки відкотив би все
# до :latest.
if grep -q '^TAG=' .env 2>/dev/null; then
  sed -i "s|^TAG=.*|TAG=$TAG|" .env
else
  printf '\nTAG=%s\n' "$TAG" >> .env
fi

echo "── тягнемо образи"
docker compose pull --quiet

echo "── база й черга"
docker compose up -d --wait postgres redis

echo "── міграції"
docker compose run --rm migrate up

wait_healthy() {
  local id="$1" name="$2" waited=0
  while [ "$waited" -lt "$WAIT_HEALTHY" ]; do
    local state
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo gone)"
    case "$state" in
      healthy|running) echo "   $name: $state"; return 0 ;;
      exited|dead|gone) echo "   $name впав під час старту"; docker logs --tail 40 "$id" || true; return 1 ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done
  echo "   $name не став healthy за ${WAIT_HEALTHY}с"
  docker logs --tail 40 "$id" || true
  return 1
}

for svc in $ROLLING; do
  echo "── $svc"
  old="$(docker compose ps -q "$svc" || true)"

  if [ -z "$old" ]; then
    # Першого разу міняти нема чого.
    docker compose up -d --no-deps "$svc"
    continue
  fi

  count="$(echo "$old" | wc -l | tr -d ' ')"
  # Піднімаємо ще один контейнер поруч зі старими. --no-recreate — щоб
  # compose не чіпав наявні: саме вони зараз тримають трафік.
  docker compose up -d --no-deps --no-recreate --scale "$svc=$((count + 1))" "$svc"

  new="$(docker compose ps -q "$svc" | grep -v -F "$old" | head -1)"
  if [ -z "$new" ]; then
    echo "   новий контейнер не зʼявився"
    exit 1
  fi

  if ! wait_healthy "$new" "$svc"; then
    # Новий не піднявся — прибираємо його й лишаємо стару версію жити.
    docker rm -f "$new" >/dev/null 2>&1 || true
    docker compose up -d --no-deps --no-recreate --scale "$svc=$count" "$svc" || true
    echo "   лишаємо стару версію $svc"
    exit 1
  fi

  # Старий перестає приймати нові зʼєднання одразу, а те, що взяв,
  # доробляє протягом GRACE. Caddy побачить відмову й піде в новий
  # контейнер — для клієнта це той самий запит, просто на іншій копії.
  for id in $old; do
    echo "   гасимо стару копію (до ${GRACE}с на доробку)"
    docker stop -t "$GRACE" "$id" >/dev/null
    docker rm "$id" >/dev/null
  done

  docker compose up -d --no-deps --no-recreate --scale "$svc=1" "$svc"
done

echo "── решта сервісів"
# shellcheck disable=SC2086
docker compose up -d --no-deps $PLAIN

echo "── прибирання"
docker image prune -f >/dev/null

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo "── готово: $TAG"
