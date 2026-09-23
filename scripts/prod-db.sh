#!/usr/bin/env bash
# Виконати команду з DATABASE_URL, що дивиться в прод-базу через тунель.
#
#   scripts/prod-db.sh bun scripts/dev-plant.mjs --nickname міцний_помел --stage 1
#
# Постгрес порту назовні не публікує (і не має), тому тунель іде на
# контейнер. IP контейнера питаємо щоразу: після кожного rollout він інший,
# а зашитий у скрипт застарів би мовчки — з'єднання просто не відкрилося б.
#
# DATABASE_URL_LOCAL підміняємо навмисно: дев-скрипти дивляться спершу на
# неї, і з локальним значенням «прод-команда» тихо правила б локальну базу.
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
# Ключ віддаємо ssh копією з правами 600 (23.09.2026). Причина — WSL: диск
# Windows монтується з 0777, chmod на /mnt/d нічого не міняє, і ssh такий
# ключ відмовляється брати («UNPROTECTED PRIVATE KEY FILE» → Permission
# denied). Копія лежить у приватній теці рівно стільки, скільки триває
# команда, і зникає разом із тунелем. У повідомленнях лишається шлях до
# справжнього ключа: людині потрібен він, а не тимчасовий.
keydir="$(mktemp -d)"
chmod 700 "$keydir"
tunnel=""
cleanup() {
  [ -n "$tunnel" ] && kill "$tunnel" 2>/dev/null
  rm -rf "$keydir"
  return 0
}
trap cleanup EXIT
[ -f "$KEY" ] || { echo "✗ немає ключа $KEY — зроби make keys-ssh" >&2; exit 1; }
(umask 077; cat "$KEY" > "$keydir/key")

ssh_opts=(-i "$keydir/key" -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
ssh_run() { ssh "${ssh_opts[@]}" "$@"; }

[ $# -gt 0 ] || { echo "вкажи команду: scripts/prod-db.sh <команда…>" >&2; exit 1; }

# Змішана пара: bash із WSL, а команда — windows-програма. Саме це видає
# make з PowerShell: у PATH там `bash` — це C:\Windows\System32\bash.exe,
# тобто WSL, а $(BUN) — C:/…/bun.exe. Разом вони не працюють ніяк
# (з'ясовано 23.09.2026): такого шляху в WSL немає; змінні оточення через
# межу WSL→Windows самі не проходять; а тунель, піднятий усередині WSL,
# windows-процес не бачить — ERR_POSTGRES_CONNECTION_REFUSED.
#
# Перекладати все це туди-сюди немає сенсу: у Git Bash той самий шлях уже
# працює. Тому просто перезапускаємо себе в ньому. Якщо make запускають
# працює. Тому просто перезапускаємо себе в ньому. Якщо ж і bash, і bun —
# з WSL, усе лишається всередині WSL, і ця гілка не спрацьовує.
if grep -qi microsoft /proc/version 2>/dev/null; then
  # Windows-програма — це і явний C:/… шлях, і звичайне `bun`, яке в PATH
  # WSL резолвиться в /mnt/c/… (interop підмішує туди windows-шляхи).
  windows_cmd=""
  case "${1:-}" in [A-Za-z]:/*) windows_cmd=1 ;; esac
  case "$(command -v "${1:-}" 2>/dev/null || true)" in /mnt/[a-z]/*) windows_cmd=1 ;; esac
  case "$windows_cmd" in
    1)
      gitbash="/mnt/c/Program Files/Git/bin/bash.exe"
      [ -x "$gitbash" ] || {
        echo "✗ команда — windows-програма ($1), а цей bash із WSL: тунель до прода" >&2
        echo "  windows-процес не побачить. Запусти make з Git Bash або постав WSL-bun." >&2
        exit 1
      }
      exec "$gitbash" "$(wslpath -w "$0")" "$@"
      ;;
  esac
fi

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
  # Порт зʼявляється не миттєво: чекаємо до 10 с і падаємо, якщо ssh помер.
  for _ in $(seq 1 40); do
    if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then exec 3<&- 3>&-; break; fi
    kill -0 "$tunnel" 2>/dev/null || { echo "✗ тунель не піднявся (ssh вийшов)" >&2; exit 1; }
    sleep 0.25
  done
  echo "⚠ працюємо з ПРОДОМ (тунель :$PORT → $ip:5432)"
fi
# Обидві змінні — на прод, і жодної порожньої. Порожню WSL через межу в
# windows-процес не передає взагалі, bun бачить її відсутньою, підхоплює
# DATABASE_URL_LOCAL із .env — і «прод-команда» мовчки править локальну базу
# (спіймано 23.09.2026). Дев-скрипти дивляться спершу на …_LOCAL, тож хай
# обидві вказують в одне місце: куди б скрипт не глянув, це прод.
url="postgres://extrovert:$pass@127.0.0.1:$PORT/extrovert"
DATABASE_URL_LOCAL="$url" DATABASE_URL="$url" "$@"
