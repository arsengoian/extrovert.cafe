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
# ⚠️ На Raspbian 9 tzdata знає лише Europe/Kiev — алias Europe/Kyiv зʼявився аж
# у tzdata 2022b. Якщо передати Kyiv, `timedatectl` відмовиться, а `ln -sf`
# мовчки зробить БИТИЙ симлінк, і малина поїде на UTC. Тому нижче — перевірка
# наявності зони, а не сподівання.
TZ_NAME="${TZ_NAME:-Europe/Kiev}"

echo "== було на малині =="
ssh "$HOST" 'date; echo "timedatectl:"; timedatectl 2>/dev/null | head -4 || true'

NOW_UTC="$(date -u '+%Y-%m-%d %H:%M:%S')"
echo "== ставимо UTC $NOW_UTC =="
ssh -t "$HOST" "
  TZ='$TZ_NAME'
  # старий tzdata: Kyiv → Kiev. Міняємо тільки якщо файлу зони справді немає.
  [ -f \"/usr/share/zoneinfo/\$TZ\" ] || TZ=\"\${TZ/Kyiv/Kiev}\"
  if [ -f \"/usr/share/zoneinfo/\$TZ\" ]; then
    sudo timedatectl set-timezone \"\$TZ\" 2>/dev/null || \
      sudo ln -sf \"/usr/share/zoneinfo/\$TZ\" /etc/localtime
  else
    echo \"!! зони '$TZ_NAME' немає в tzdata, лишаю як є\" >&2
  fi
  sudo date -u -s '$NOW_UTC'
  # закріпити, щоб наступний холодний старт піднявся з правильним часом
  sudo fake-hwclock save 2>/dev/null || true
  # і спробувати підтягнути NTP, якщо мережа є
  (sudo systemctl restart systemd-timesyncd 2>/dev/null || sudo systemctl restart ntp 2>/dev/null) || true
"
echo "== стало =="
ssh "$HOST" 'date'
