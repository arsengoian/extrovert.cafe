#!/usr/bin/env bash
# Костиль запису на малині + замір, чого він коштує. Запускати НА Pi.
#
# Пише те саме, що піде в прод: -c copy у MPEG-TS хвилинними сегментами.
# Декодування немає — це demux+remux, чисте перекладання байтів.
#
#   CAM=rtsp://192.168.5.10:8554/cam1 BUF=/mnt/buf MIN=20 ./rec-test.sh
set -euo pipefail
CAM="${CAM:?вкажи CAM=rtsp://<IP-ПК>:8554/cam1}"
BUF="${BUF:-/home/pi/buf}"
MIN="${MIN:-20}"                       # скільки хвилин крутити
LOG="${LOG:-/home/pi/rec-test.csv}"

mkdir -p "$BUF"
echo "== пишу з $CAM у $BUF, $MIN хв, метрики → $LOG =="

ffmpeg -nostdin -loglevel warning \
  -rtsp_transport tcp -use_wallclock_as_timestamps 1 \
  -i "$CAM" -c copy \
  -f segment -segment_time 60 -reset_timestamps 1 -segment_format mpegts \
  -strftime 1 "$BUF/%Y%m%dT%H%M%S.ts" &
FF=$!
trap 'kill $FF 2>/dev/null || true' EXIT INT TERM

echo "ts,ffmpeg_cpu,chromium_cpu,load1,mem_free_mb,temp_c,segments,buf_mb" > "$LOG"
END=$(( $(date +%s) + MIN*60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  sleep 10
  kill -0 $FF 2>/dev/null || { echo "!! ffmpeg помер, дивись вище"; break; }
  FCPU=$(ps -o %cpu= -p $FF 2>/dev/null | tr -d ' '); FCPU=${FCPU:-0}
  CCPU=$(ps -C chromium-browser -o %cpu= 2>/dev/null | awk '{s+=$1} END{printf "%.1f", s+0}')
  LOAD=$(awk '{print $1}' /proc/loadavg)
  MEM=$(free -m | awk '/^Mem:/{print $7?$7:$4}')
  TEMP=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
  SEG=$(ls -1 "$BUF"/*.ts 2>/dev/null | wc -l)
  SZ=$(du -sm "$BUF" 2>/dev/null | awk '{print $1}')
  echo "$(date +%H:%M:%S),$FCPU,$CCPU,$LOAD,$MEM,$TEMP,$SEG,$SZ" | tee -a "$LOG"
done

kill $FF 2>/dev/null || true; wait $FF 2>/dev/null || true
echo
echo "== підсумок =="
awk -F, 'NR>1{fc+=$2;cc+=$3;n++; if($2>mf)mf=$2; if($6>mt)mt=$6}
         END{if(n)printf "ffmpeg CPU сер %.1f%% макс %.1f%% · chromium сер %.1f%% · темп макс %.1f°C\n",fc/n,mf,cc/n,mt}' "$LOG"
echo "сегментів: $(ls -1 "$BUF"/*.ts 2>/dev/null | wc -l) · обсяг: $(du -sh "$BUF" 2>/dev/null | awk '{print $1}')"
echo "цілісність останніх трьох сегментів:"
ls -1t "$BUF"/*.ts 2>/dev/null | head -3 | while read f; do
  printf '  %s ' "$(basename "$f")"
  ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f" 2>/dev/null || echo "не читається"
done
