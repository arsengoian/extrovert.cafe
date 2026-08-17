#!/usr/bin/env bash
# Синхронізувати годинник Raspberry Pi з цією машиною.
#
# У Pi 1 немає RTC — після кожного знеструмлення він піднімається з часом,
# збереженим fake-hwclock, тобто з моменту останнього коректного вимкнення.
# Якщо дата з᾿їхала на рік, ламається не лише статистика:
#   · HTTPS до Cloudflare відвалюється — сертифікат «ще не дійсний»,
#     кіоск показує застарілі ціни й банер «немає звʼязку»;
#   · apt лається на Release-файли (у нас це вже обійдено Check-Valid-Until).
#
# Використання:  ./fix-clock.sh [pi@192.168.5.45]
set -euo pipefail
HOST="${1:-pi@192.168.5.45}"
TZ_NAME="${TZ_NAME:-Europe/Kyiv}"

echo "== було на малині =="
ssh "$HOST" 'date; echo "timedatectl:"; timedatectl 2>/dev/null | head -4 || true'

NOW_UTC="$(date -u '+%Y-%m-%d %H:%M:%S')"
echo "== ставимо UTC $NOW_UTC =="
ssh -t "$HOST" "
  sudo timedatectl set-timezone '$TZ_NAME' 2>/dev/null || \
    sudo ln -sf /usr/share/zoneinfo/$TZ_NAME /etc/localtime
  sudo date -u -s '$NOW_UTC'
  # закріпити, щоб наступний холодний старт піднявся з правильним часом
  sudo fake-hwclock save 2>/dev/null || true
  # і спробувати підтягнути NTP, якщо мережа є
  (sudo systemctl restart systemd-timesyncd 2>/dev/null || sudo systemctl restart ntp 2>/dev/null) || true
"
echo "== стало =="
ssh "$HOST" 'date'
