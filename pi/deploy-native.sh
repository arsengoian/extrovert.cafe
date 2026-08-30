#!/usr/bin/env bash
# Викласти pos-native на Raspberry Pi й зібрати нативно на місці.
#
# На відміну від deploy.sh (старий Chromium-кіоск, копіює готову статику),
# тут на Pi їде ВИХІДНИЙ код — бінарник збирається на самій малині (make pi,
# gcc 6.3/glibc 2.24 з apt), не крос-компіляцією. Причина — у коментарі над
# ціллю `pi:` у pos-native/Makefile.
#
# Один тарбол, а не rsync: дерево невелике (~11 МБ, здебільшого assets/*.png),
# і на відміну від старого deploy.sh тут нема risку зачепити зайве --delete'ом
# (весь DEST — наш, нічого стороннього поруч не лежить).
#
# Використання:
#   ./deploy-native.sh                    # pi@192.168.5.45, тільки збірка
#   ./deploy-native.sh pi@10.0.0.5         # інша адреса
#   RESTART=1 ./deploy-native.sh           # + перезапустити pos-native.service
#
# RESTART=1 замовчання вимкнено навмисно: пристрій зараз не прод (жива
# кіоск-адреса ще не призначена), і рестарт сервісу, якого там ще нема
# (pos-native.service встановлюється окремо, дивись pi/README.md), просто
# впаде в помилку. Коли пристрій стане продом — вмикати явно.
set -euo pipefail
HOST="${1:-pi@192.168.5.45}"
DEST="${DEST:-/home/pi/pos-native}"
SRC_DIR="$(cd "$(dirname "$0")/../pos-native" && pwd)"
TAR="/tmp/pos-native-src.tar.gz"
# Окремий ключ лише для деплою (pos-native/.deploy/, у .gitignore) — не
# чіпає особистий ключ і не потребує пароля щоразу.
IDFILE="$SRC_DIR/.deploy/id_ed25519"
SSH_OPTS=(-o BatchMode=yes)
[ -f "$IDFILE" ] && SSH_OPTS+=(-i "$IDFILE")

echo "== пакую $SRC_DIR =="
tar -czf "$TAR" -C "$SRC_DIR" src assets third_party Makefile

echo "== заливаю $TAR → $HOST:$TAR =="
scp -q "${SSH_OPTS[@]}" "$TAR" "$HOST:$TAR"
rm -f "$TAR"

echo "== розпаковую й збираю на $HOST =="
ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<REMOTE
set -e
mkdir -p '$DEST'
tar -xzf /tmp/pos-native-src.tar.gz -C '$DEST'
rm -f /tmp/pos-native-src.tar.gz
cd '$DEST'
make pi
REMOTE

if [ "${RESTART:-0}" = "1" ]; then
  echo "== перезапускаю pos-native.service =="
  ssh "${SSH_OPTS[@]}" "$HOST" "sudo systemctl restart pos-native"
  echo "== journalctl -u pos-native (останні 15 рядків) =="
  ssh "${SSH_OPTS[@]}" "$HOST" "sudo journalctl -u pos-native -n 15 --no-pager"
else
  echo "== зібрано, сервіс НЕ чіпав (RESTART=1, щоб перезапустити) =="
fi
