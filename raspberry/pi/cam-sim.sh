#!/usr/bin/env bash
# Емулятор камери Tapo C100 — запускати НА ПК, малина підключатиметься по мережі.
#
# Параметри підібрані під реальні: 1920×1080, 15 fps, H.264, ~0,76 Мбіт/с,
# ключовий кадр раз на 2 секунди. Для малини це байт-у-байт така сама робота,
# як зі справжньою камерою: вона все одно нічого не декодує.
#
# Використання:
#   ./cam-sim.sh                 # варіант без зайвого софту (ffmpeg у режимі RTSP-сервера)
#   ./cam-sim.sh mediamtx        # якщо поруч лежить бінарник mediamtx
set -euo pipefail
MODE="${1:-ffmpeg}"
PORT="${PORT:-8554}"
BR="${BR:-760k}"                 # 0,76 Мбіт/с — як у C100 за офіційною таблицею

ENC=(-c:v libx264 -preset veryfast -tune zerolatency
     -b:v "$BR" -maxrate "$BR" -bufsize "$((${BR%k}*2))k"
     -g 30 -keyint_min 30 -sc_threshold 0 -pix_fmt yuv420p)

IP=$(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
[ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo "== камера буде тут: rtsp://${IP:-<IP-цього-ПК>}:$PORT/cam1 =="
echo "== на малині: BUF=/mnt/buf CAM=rtsp://${IP}:$PORT/cam1 ./rec-test.sh =="
echo

if [ "$MODE" = "mediamtx" ]; then
  echo "Запусти в іншому вікні:  ./mediamtx"
  exec ffmpeg -hide_banner -re -f lavfi -i "testsrc2=size=1920x1080:rate=15" \
       "${ENC[@]}" -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:$PORT/cam1"
fi

# Без зайвого софту: сам ffmpeg слухає порт і віддає потік першому клієнту.
exec ffmpeg -hide_banner -re -f lavfi -i "testsrc2=size=1920x1080:rate=15" \
     "${ENC[@]}" -f rtsp -rtsp_flags listen "rtsp://0.0.0.0:$PORT/cam1"
