#!/usr/bin/env bash
# Виконати команду з DATABASE_URL, що дивиться в прод-базу через тунель.
#
#   scripts/prod-db.sh bun scripts/dev-plant.mjs --nickname міцний_помел --stage 1
#
# Постгрес порту назовні не публікує (і не має), тому тунель іде на
# контейнер. IP контейнера питаємо щоразу: після кожного rollout він інший,
# а зашитий у скрипт застарів би мовчки — з'єднання просто не відкрилося б.
#
# DATABASE_URL_LOCAL прибираємо навмисно: дев-скрипти дивляться спершу на
# неї, і з нею «прод-команда» тихо правила б локальну базу.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${SSH_KEY:-$ROOT/keys/extrovert_ed25519}"
SERVER="${SERVER:-root@46.101.213.31}"
SSH_PORT="${SSH_PORT:-2222}"
PORT="${PORT:-5455}"
# accept-new, а не просто BatchMode (23.09.2026). make з PowerShell запускає
# bash із власним HOME, і known_hosts там свій — часто порожній. У пакетному
# режимі ssh спитати нічого не може й падає з «Host key verification failed»,
# хоч ключ сервера ніхто не міняв. Змінений ключ і далі валить зʼєднання —
# саме це в перевірці й важить. Так само робить scripts/env-prod.mjs.
ssh_opts=(-i "$KEY" -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
ssh_run() { ssh "${ssh_opts[@]}" "$@"; }

[ $# -gt 0 ] || { echo "вкажи команду: scripts/prod-db.sh <команда…>" >&2; exit 1; }

pass=$(grep -m1 '^POSTGRES_PASSWORD=' "$ROOT/.env.prod" | cut -d= -f2-)
[ -n "$pass" ] || { echo "✗ немає POSTGRES_PASSWORD у .env.prod" >&2; exit 1; }

# Тунель міг лишитись від попередньої команди — тоді просто користуємось
# ним. Інакше друга команда підряд падала б із «Address already in use», а
# вбивати чужий тунель наосліп небезпечно: у ньому може йти інша робота.
if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  exec 3<&- 3>&-
  echo "⚠ працюємо з ПРОДОМ (тунель :$PORT уже відкритий)"
else
  ip=$(ssh_run "$SERVER" "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' extrovert-postgres-1" </dev/null) || {
    echo "✗ не зайшли на $SERVER (порт $SSH_PORT) ключем $KEY" >&2
    echo "  перевір руками: ssh -i \"$KEY\" -p $SSH_PORT $SERVER" >&2
    exit 1
  }
  [ -n "$ip" ] || { echo "✗ не знайшов контейнер бази на сервері" >&2; exit 1; }
  # Без -f, у фон шелом: так ми знаємо pid і справді прибираємо за собою.
  # З pgrep не виходило — у Git Bash його просто немає, тунель лишався жити
  # після кожного запуску, а наступний бачив «уже відкритий» і користувався
  # чужим (23.09.2026).
  # Напряму, а не через ssh_run: у фон іде функція, і $! був би pid підболонки,
  # а не ssh. Підболонку kill прибирає, ssh.exe на Windows лишається жити.
  ssh "${ssh_opts[@]}" -N -o ExitOnForwardFailure=yes -L "$PORT:$ip:5432" "$SERVER" &
  tunnel=$!
  cleanup() { [ -n "${tunnel:-}" ] && kill "$tunnel" 2>/dev/null || true; }
  trap cleanup EXIT
  # Порт зʼявляється не миттєво: чекаємо до 10 с і падаємо, якщо ssh помер.
  for _ in $(seq 1 40); do
    if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then exec 3<&- 3>&-; break; fi
    kill -0 "$tunnel" 2>/dev/null || { echo "✗ тунель не піднявся (ssh вийшов)" >&2; exit 1; }
    sleep 0.25
  done
  echo "⚠ працюємо з ПРОДОМ (тунель :$PORT → $ip:5432)"
fi
DATABASE_URL_LOCAL= DATABASE_URL="postgres://extrovert:$pass@127.0.0.1:$PORT/extrovert" "$@"
