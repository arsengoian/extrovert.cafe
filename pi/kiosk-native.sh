#!/bin/bash
# EXTROVERT.CAFE — кіоск меню, нативний рендерер (pos-native, dispmanx+GLES2).
#
# Заміна pi/archive/kiosk-chromium.sh: замість браузера — окремий бінарник
# pos-native, який сам малює сторінку через Cairo+GLES2 і сам тягне JSON з
# API. Малює прямо в dispmanx-шар, тому X11/xset/unclutter тут не потрібні —
# немає вікна, яке треба ховати чи будити.
#
#   ~/kiosk.env    — пише deploy-native.sh (POINT, ANIM). Стерти → прод.
#   ~/kiosk.extra  — руками (EXTRA=...), переживає перезапис kiosk.env.
[ -f "$HOME/kiosk.env" ]   && . "$HOME/kiosk.env"
[ -f "$HOME/kiosk.extra" ] && . "$HOME/kiosk.extra"

POINT="${POINT:-kyiv-01}"
export URL="${URL:-https://pos.extrovert.cafe/api/v1/points/$POINT/menu}"
export ASSETS="${ASSETS:-/home/pi/pos-native/assets}"
export TELEMETRY_SOCK="${TELEMETRY_SOCK:-/tmp/pos-native.sock}"
BIN="${BIN:-/home/pi/pos-native/bin/pos-native-pi}"
LOG=/home/pi/kiosk-native.log

exec >> "$LOG" 2>&1
echo "=== старт $(date) · URL=$URL ASSETS=$ASSETS BIN=$BIN ==="

# Раніше це запускала LXDE autostart (~/scripts/start.sh) поряд з
# kiosk-chromium.sh. Без X ніхто інший цей файл не викличе, тож перенесено
# сюди: гасить світлодіоди на корпусі. Скрипт лишається на місці —
# необов'язковий (`|| true`), щоб відсутність llctl на іншому пристрої не
# зупиняла кіоск.
[ -x "$HOME/scripts/start.sh" ] && "$HOME/scripts/start.sh" 2>&1 || true

# Чекаємо мережу лише для продової адреси — так само, як у kiosk-chromium.sh:
# для локального тестового сервера цей цикл лише додав би чорний екран.
case "$URL" in
  https://*|http://pos.*)
    for i in $(seq 1 30); do
      curl -sf --max-time 5 -o /dev/null https://pos.extrovert.cafe/healthz && break
      echo "мережі ще нема, спроба $i"; sleep 4
    done ;;
esac

while true; do
  echo "--- запуск pos-native $(date) ---"
  "$BIN"
  echo "pos-native вийшов, код $? — рестарт через 5 c"
  sleep 5
done
