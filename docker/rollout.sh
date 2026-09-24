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
# Решта — звичайний перезапуск: трафіку ззовні в них немає, і те, що вони на
# півхвилини зникають, не бачить ніхто.
PLAIN="scheduler overseer glitchtip glitchtip-worker"
# Caddy тут немає навмисно — він єдиний тримає 80/443 і має власний крок
# нижче (caddy_step).

cd "$DIR"

echo "── тег $TAG"
# Тег лишається в .env, щоб будь-який `docker compose` на сервері бачив ту
# саму версію, що й викотили. Інакше ручний `up -d` мовчки відкотив би все
# до :latest. .env — симлінк на .env.prod (make env-push), і --follow-symlinks
# обовʼязковий: без нього sed -i замінив би симлінк звичайним файлом, і
# наступне оновлення оточення вже нічого б не змінило.
if grep -q '^TAG=' .env 2>/dev/null; then
  sed -i --follow-symlinks "s|^TAG=.*|TAG=$TAG|" .env
else
  printf '\nTAG=%s\n' "$TAG" >> .env
fi

echo "── тягнемо образи"
docker compose pull --quiet

echo "── база й черга"
docker compose up -d --wait postgres redis

# </dev/null у командах нижче — не прикраса: сам цей скрипт їде в `bash -s`
# через stdin, і будь-яка команда, що читає stdin, з'їдає його решту. На
# першому викочуванні 22.09.2026 rollout так і обірвався — мовчки, одразу
# після створення бази glitchtip, лишивши підняті тільки postgres і redis.
#
# База GlitchTip: postgres на першому старті створює лише свою (POSTGRES_DB),
# а glitchtip без власної бази падає в циклі перезапусків. Ідемпотентно.
echo "── база glitchtip"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -tAc "select 1 from pg_database where datname = '\''glitchtip'\''" | grep -q 1 || createdb -U "$POSTGRES_USER" glitchtip' </dev/null

echo "── міграції"
docker compose run --rm migrate up </dev/null

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

# ── caddy ────────────────────────────────────────────────────────────────
# Поки caddy перестворюється, назовні не відповідає ніхто: ні api, ні ws, ні
# статика. Навантажувальний тест 23.09.2026 зловив саме це — 8,4 с без
# відповіді й три розриви ws, хоча api/ws/checkbox перемкнулись без жодної
# втрати.
#
# І найприкріше — розрив був ні за що. В імені образу стоїть ${TAG}, тег
# міняється щодеплою, compose бачить інший рядок і перестворює контейнер.
# А образ за тим тегом той самий: коли в docker/caddy нічого не змінилось,
# CI не збирає нічого, а лише вішає новий тег на старий образ (deploy.yml,
# «Перетегувати наявний образ»). Тому дивимось не на тег, а на digest.
#
# Якщо образ таки інший — це майже завжди правка Caddyfile, а конфіг caddy
# уміє перечитувати на льоту, не рвучи зʼєднань. Контейнер при цьому лишається
# на старому образі: оновити сам caddy можна RECREATE_CADDY=1, і тоді кілька
# секунд простою — свідома плата.
caddy_step() {
  local running new_ref new_id cur_id applied tmp cid
  running="$(docker compose ps -q caddy || true)"
  if [ -z "$running" ]; then
    echo "   caddy не запущений — піднімаємо"
    docker compose up -d --no-deps caddy
    return
  fi

  if [ "${RECREATE_CADDY:-0}" = "1" ]; then
    echo "   RECREATE_CADDY=1 — перестворюємо (кілька секунд без відповіді)"
    docker compose up -d --no-deps --force-recreate caddy
    return
  fi

  new_ref="$(docker compose config --images | grep -m1 'extrovert-caddy' || true)"
  new_id="$(docker image inspect -f '{{.Id}}' "$new_ref" 2>/dev/null || true)"
  cur_id="$(docker inspect -f '{{.Image}}' "$running" 2>/dev/null || true)"
  # Не змогли порівняти — поводимось як раніше. Тиха відмова тут означала б
  # непомічений простій, а гучна — зламаний деплой через дрібницю.
  if [ -z "$new_id" ] || [ -z "$cur_id" ]; then
    echo "   ⚠ не вдалось порівняти образи ($new_ref) — звичайне оновлення"
    docker compose up -d --no-deps caddy
    return
  fi
  # Після перечитування конфігу контейнер лишається на старому образі — тому
  # памʼятаємо, конфіг ЯКОГО образу в ньому вже застосований. Без цього кожен
  # наступний деплой бачив би розбіжність digest-ів і робив зайвий reload,
  # а в логи щоразу падало б попередження про дрейф.
  applied="$(docker exec "$running" cat /etc/caddy/.applied 2>/dev/null || true)"
  if [ "$new_id" = "$cur_id" ] || [ "$new_id" = "$applied" ]; then
    echo "   конфіг цього образу вже застосований — не чіпаємо"
    docker compose up -d --no-deps --no-recreate caddy >/dev/null
    return
  fi

  echo "   образ інший — пробуємо перечитати конфіг без розриву"
  tmp="$(mktemp -d)"
  cid="$(docker create "$new_ref")"
  docker cp "$cid:/etc/caddy/Caddyfile" "$tmp/Caddyfile" >/dev/null
  docker rm "$cid" >/dev/null

  # Новий конфіг спершу лягає поруч і перевіряється, і тільки потім стає
  # основним: підсунути в контейнер битий Caddyfile означало б, що caddy не
  # підніметься після першого ж перезавантаження дроплета.
  if docker cp "$tmp/Caddyfile" "$running:/etc/caddy/Caddyfile.new" \
     && docker exec "$running" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.new \
     && docker exec "$running" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile.new \
     && docker exec "$running" mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile \
     && docker exec "$running" sh -c "printf %s '$new_id' > /etc/caddy/.applied"; then
    echo "   конфіг перечитано, зʼєднання не рвались"
    echo "   ⚠ контейнер лишився на образі $cur_id — сам caddy оновить RECREATE_CADDY=1"
  else
    echo "   перечитати не вдалось — перестворюємо (кілька секунд без відповіді)"
    docker exec "$running" rm -f /etc/caddy/Caddyfile.new >/dev/null 2>&1 || true
    docker compose up -d --no-deps --force-recreate caddy
  fi
  rm -rf "$tmp"
}

echo "── caddy"
caddy_step

echo "── прибирання"
docker image prune -f >/dev/null

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo "── готово: $TAG"
