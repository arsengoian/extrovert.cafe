#!/usr/bin/env bash
# pi-ssh.sh — зайти на малину точки звідки завгодно, через її зворотний
# тунель на дроплеті (raspberry-pi.md, «Тунель»).
#
#   bash scripts/pi-ssh.sh                  # kyiv-01, інтерактивно
#   bash scripts/pi-ssh.sh kyiv-01 'uptime' # одна команда
#
# Порт точки береться з бази (points.tunnel_port) через той самий дроплет.
# Ключі: root дроплета — keys/extrovert_ed25519, малина — та сама пара, що й
# для входу з мережі кав'ярні (raspberry/kiosk/.deploy/id_ed25519).
set -euo pipefail
cd "$(dirname "$0")/.."
POINT="${1:-kyiv-01}"; shift || true
DROPLET="${DROPLET:-46.101.213.31}"
JUMP_KEY=keys/extrovert_ed25519
PI_KEY=raspberry/kiosk/.deploy/id_ed25519

PORT=$(ssh -p 2222 -i "$JUMP_KEY" -o BatchMode=yes "root@$DROPLET" \
  "docker exec extrovert-postgres-1 psql -U extrovert -d extrovert -tA -c \"select tunnel_port from points where id = '$POINT'\"")
[ -n "$PORT" ] || { echo "✗ у точки $POINT ще немає порту тунелю — малина не реєструвалась" >&2; exit 1; }

exec ssh -i "$PI_KEY" \
  -o "ProxyCommand=ssh -p 2222 -i $JUMP_KEY -o BatchMode=yes -W %h:%p root@$DROPLET" \
  -o "HostKeyAlias=pi-$POINT" -p "$PORT" pi@127.0.0.1 "$@"
