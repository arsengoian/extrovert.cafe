#!/bin/bash
# Кіоск: чекає мережу, чистить ознаки «браузер впав», тримає Chromium у циклі.
# РЕКОНСТРУКЦІЯ з сесії — звірити з ~/kiosk.sh на пристрої.

# Налаштування, які змінює deploy.sh, лежать окремо, щоб не правити цей файл
# на кожен експеримент. Формат — рядки VAR=value.
[ -f "$HOME/kiosk.env" ] && . "$HOME/kiosk.env"

POINT="${POINT:-kyiv-01}"
URL="${URL:-https://pos.extrovert.cafe/p/$POINT}"
PROFILE="$HOME/.config/chromium"
LEAN="${LEAN:-0}"      # 1 — режим економії памʼяті для Pi 1, див. нижче

# мережа може піднятися пізніше за десктоп
for i in $(seq 1 30); do
  ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && break
  sleep 2
done

# Прапорці економії. На Pi 1 з 384 МБ найбільше дає --single-process:
# зникають окремі процеси zygote і GPU, це десятки мегабайтів.
# Ціна — падіння рендерера кладе весь браузер, але його все одно піднімає цикл.
LEAN_FLAGS=""
if [ "$LEAN" = "1" ]; then
  LEAN_FLAGS="--single-process --disable-dev-shm-usage --disable-extensions
              --disable-background-networking --disable-sync
              --disable-component-update --renderer-process-limit=1"
fi

while true; do
  # інакше Chromium показує «Відновити сторінки?» після кожного знеструмлення
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' \
      "$PROFILE/Default/Preferences" 2>/dev/null
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' \
      "$PROFILE/Default/Preferences" 2>/dev/null

  chromium-browser \
    --kiosk --incognito \
    --password-store=basic \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    --disable-translate --disable-features=Translate \
    --check-for-update-interval=31536000 \
    --disable-pinch --overscroll-history-navigation=0 \
    $LEAN_FLAGS \
    "$URL"

  sleep 5     # впав — піднімаємо
done
