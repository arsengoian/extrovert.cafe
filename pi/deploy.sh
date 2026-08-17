#!/usr/bin/env bash
# Викласти статику кіоска на Raspberry Pi і перезапустити браузер.
#
# Кіоск читає сторінку з локального сервера на самій малині (див. kiosk.sh),
# тому «деплой» = скопіювати три файли й перезапустити Chromium.
#
# Використання:
#   ./deploy.sh                        # pi@192.168.5.45, рівень анімацій за замовчанням
#   ./deploy.sh pi@10.0.0.5            # інша адреса
#   ANIM=4 HUD=1 ./deploy.sh           # прогін для заміру: усі анімації + лічильник fps
#   LEAN=1 ./deploy.sh                 # Chromium у режимі економії памʼяті (--single-process)
#
# Сторінка береться з локального сервера на самій малині, а не з Cloudflare:
# так можна ганяти правки без деплою у прод. Повернути прод — стерти
# /home/pi/kiosk.env і перезапустити kiosk.sh.
set -euo pipefail
HOST="${1:-pi@192.168.5.45}"
DEST="${DEST:-/home/pi/kiosk}"
SRC="$(cd "$(dirname "$0")/../pos/public" && pwd)"

ANIM="${ANIM:-}"; HUD="${HUD:-}"; GPU="${GPU:-}"
Q=""
[ -n "$ANIM" ] && Q="${Q}&anim=${ANIM}"
[ -n "$HUD"  ] && Q="${Q}&hud=${HUD}"
[ -n "$GPU"  ] && Q="${Q}&gpu=${GPU}"
[ -n "$Q" ] && Q="?${Q#&}"

echo "== копіюю $SRC → $HOST:$DEST =="
ssh "$HOST" "mkdir -p '$DEST'"
if command -v rsync >/dev/null 2>&1; then
  rsync -av --delete "$SRC/" "$HOST:$DEST/"
else
  scp -r "$SRC/." "$HOST:$DEST/"          # Windows/Git Bash без rsync
fi

echo "== URL кіоска: http://localhost:8080/index.html$Q =="
ssh "$HOST" "
  set -e
  # kiosk.sh бере URL зі змінної; підміняємо її, не чіпаючи сам скрипт
  {
    echo 'URL=http://localhost:8080/index.html$Q'
    echo 'LEAN=${LEAN:-0}'
  } > /home/pi/kiosk.env
  pkill -f 'python3 -m http.server 8080' 2>/dev/null || true
  cd '$DEST' && nohup python3 -m http.server 8080 >/dev/null 2>&1 &
  sleep 1
  pkill -f chromium 2>/dev/null || true
"
echo "== перезапускаю кіоск =="
ssh "$HOST" "nohup /home/pi/kiosk.sh >/home/pi/kiosk.log 2>&1 & sleep 2; echo ok"
echo
echo "Готово. Якщо міряєш — відкрий екран малини і дивись HUD у правому верхньому куті."
