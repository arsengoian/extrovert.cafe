#!/bin/bash
# EXTROVERT.CAFE — кіоск меню. Chromium 65 на Raspberry Pi 1.
#
# Налаштування лежать поза скриптом, щоб експерименти не правили сам скрипт:
#   ~/kiosk.env    — пише deploy.sh (URL, LEAN). Стерти → повернеться прод.
#   ~/kiosk.extra  — руками (EXTRA=...), переживає перезапис kiosk.env.
[ -f "$HOME/kiosk.env" ]   && . "$HOME/kiosk.env"
[ -f "$HOME/kiosk.extra" ] && . "$HOME/kiosk.extra"

POINT="${POINT:-kyiv-01}"
# Роут за замовчанням несе ІДЕНТИФІКАТОР ТОЧКИ. Без нього сторінка
# відкривається, але POINT у app.js падає на дефолт — тобто друга точка
# показувала б ціни першої, і помітили б це вже на місці.
URL="${URL:-https://pos.extrovert.cafe/p/$POINT}"
LEAN="${LEAN:-0}"
EXTRA="${EXTRA:-}"
LOG=/home/pi/kiosk.log

exec >> "$LOG" 2>&1
echo "=== старт $(date) · URL=$URL LEAN=$LEAN EXTRA=$EXTRA ==="

# екран не гасне
xset s off; xset -dpms; xset s noblank

# курсор геть
unclutter -idle 0.1 -root &
xdotool mousemove 5000 5000 2>/dev/null || true

# Чекаємо мережу тільки якщо сторінка справді в мережі. Для локального
# http://localhost:8080 цей цикл коштував би до двох хвилин чорного екрана.
case "$URL" in
  https://*|http://pos.*)
    for i in $(seq 1 30); do
      curl -sf --max-time 5 -o /dev/null https://pos.extrovert.cafe/healthz && break
      echo "мережі ще нема, спроба $i"; sleep 4
    done ;;
esac

# Прапорці економії. На Pi 1 найбільше дає --single-process: зникають окремі
# процеси zygote і GPU, це десятки мегабайтів. Ціна — падіння рендерера кладе
# весь браузер, але його все одно піднімає цикл нижче.
LEAN_FLAGS=""
if [ "$LEAN" = "1" ]; then
  LEAN_FLAGS="--single-process --disable-dev-shm-usage --disable-extensions
              --disable-background-networking --disable-sync
              --disable-component-update --renderer-process-limit=1"
fi

P="$HOME/.config/chromium"
while true; do
  # прибрати плашку "Chromium некоректно завершив роботу" після зникнення живлення
  sed -i "s/\"exited_cleanly\":false/\"exited_cleanly\":true/" "$P/Local State" 2>/dev/null
  sed -i "s/\"exited_cleanly\":false/\"exited_cleanly\":true/; s/\"exit_type\":\"[^\"]*\"/\"exit_type\":\"Normal\"/" \
      "$P/Default/Preferences" 2>/dev/null

  echo "--- запуск chromium $(date) ---"
  chromium-browser \
    --kiosk --incognito --password-store=basic --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble --disable-translate \
    --no-first-run --fast --fast-start \
    --disable-pinch --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    --disable-features=TranslateUI \
    --window-position=0,0 \
    $LEAN_FLAGS $EXTRA \
    "$URL"
  echo "chromium вийшов, код $? — рестарт через 5 c"
  sleep 5
done
