#!/bin/bash
# Кіоск: чекає мережу, чистить ознаки «браузер впав», тримає Chromium у циклі.
# РЕКОНСТРУКЦІЯ з сесії — звірити з ~/kiosk.sh на пристрої.

POINT="${POINT:-kyiv-01}"
URL="${URL:-https://pos.extrovert.cafe/p/$POINT}"
PROFILE="$HOME/.config/chromium"

# мережа може піднятися пізніше за десктоп
for i in $(seq 1 30); do
  ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && break
  sleep 2
done

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
    "$URL"

  sleep 5     # впав — піднімаємо
done
