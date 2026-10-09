#!/usr/bin/env bash
# pi-forward.sh — прокинути локальний порт у мережу точки через малину та її
# зворотний тунель на дроплеті (raspberry-pi.md, «Тунель»). Так можна зайти,
# наприклад, у веб-адмінку роутера кав'ярні, не їдучи на місце: малина бачить
# роутер у своїй локалці, а ми ходимо до малини через дроплет.
#
#   bash scripts/pi-forward.sh                         # роутер kyiv-01 → localhost:47199
#   bash scripts/pi-forward.sh kyiv-01 47199 192.168.199.1:80
#   make d-router      /   make d-router TARGET=192.168.199.1:443 LPORT=8443
#
# Відкрито, доки не Ctrl+C. Потім браузером: http://localhost:<LPORT>
# (роутер може бути і на https — тоді TARGET=...:443 і https у браузері).
set -euo pipefail
cd "$(dirname "$0")/.."
POINT="${1:-kyiv-01}"
LPORT="${2:-47199}"
TARGET="${3:-192.168.199.1:80}"   # куди в мережі точки прокидаємо (host:port)
DROPLET="${DROPLET:-46.101.213.31}"

# Ключі — копія з правами 600 (на Windows репозиторні файли ssh бачить як
# 0777 і відхиляє), як у scripts/pi-ssh.sh.
KEYDIR=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/pi-fwd.$$")
mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
trap 'rm -rf "$KEYDIR"' EXIT
cp keys/extrovert_ed25519 "$KEYDIR/jump"
cp raspberry/kiosk/.deploy/id_ed25519 "$KEYDIR/pi"
chmod 600 "$KEYDIR/jump" "$KEYDIR/pi"
JUMP_KEY="$KEYDIR/jump"; PI_KEY="$KEYDIR/pi"

PORT=$(ssh -p 2222 -i "$JUMP_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "root@$DROPLET" \
  "docker exec extrovert-postgres-1 psql -U extrovert -d extrovert -tA -c \"select tunnel_port from points where id = '$POINT'\"")
[ -n "$PORT" ] || { echo "✗ у точки $POINT ще немає порту тунелю — малина не реєструвалась (або офлайн)" >&2; exit 1; }

echo "Відкрито: http://localhost:$LPORT → $TARGET на $POINT. Ctrl+C — закрити."
exec ssh -i "$PI_KEY" \
  -o "ProxyCommand=ssh -p 2222 -i $JUMP_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -W %h:%p root@$DROPLET" \
  -o "HostKeyAlias=pi-$POINT" -o StrictHostKeyChecking=accept-new \
  -p "$PORT" -L "$LPORT:$TARGET" -N pi@127.0.0.1
