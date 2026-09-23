#!/bin/sh
# telemetry.sh — розповідає серверу, як почувається точка.
#
# Компонент стеку (components.conf), тобто приїжджає звичайним оновленням і
# піднімається супервізором. Раз на TELEMETRY_PERIOD_S збирає метрики й шле
# їх у api.
#
# Головне правило — **не втрачати проби при обриві інтернету**
# (docs/admin_panel.md): усе, що не пішло, лягає в state/telemetry.queue і
# досилається наступного разу. Кожна проба має idem_key, і сервер приймає
# її рівно один раз — тож повтор після обриву не подвоює історію.
#
# Токен точки — той самий файл, що й для подій ws (config/point.key): він
# довгий і видається руками (scripts/point-token.mjs). Немає файла — немає
# телеметрії, і це не помилка: точка просто працює без неї.
set -u
LOG_TAG=telemetry
. "$(dirname "$0")/common.sh"

API="${API_URL:-https://api.extrovert.cafe/api/v1}"
PERIOD="${TELEMETRY_PERIOD_S:-300}"
TOKEN_FILE="${WS_TOKEN_FILE:-$EXTROVERT_ROOT/config/point.key}"
QUEUE="$EXTROVERT_STATE/telemetry.queue"
QUEUE_MAX=500                      # ~2 доби проб: більше нікому не потрібно
PING_HOST="${TELEMETRY_PING_HOST:-api.extrovert.cafe}"

STOPPING=0
trap 'STOPPING=1' TERM INT

# ── метрики ──────────────────────────────────────────────────────────────
# Усе рахуємо тим, що є в Raspbian Stretch: /proc, vcgencmd, ping, df.
cpu_percent() {
    # Миттєве завантаження з /proc/stat: дві проби з паузою в секунду.
    set -- $(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat)
    _t1=$1; _i1=$2
    sleep 1
    set -- $(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat)
    _t2=$1; _i2=$2
    # Дужки навколо тернарного — обовʼязкові: інакше awk читає «> 0» як
    # перенаправлення виводу у файл «0» і падає з Permission denied.
    awk -v t1="$_t1" -v i1="$_i1" -v t2="$_t2" -v i2="$_i2" \
        'BEGIN { dt = t2 - t1; di = i2 - i1; printf "%.0f", (dt > 0 ? (1 - di / dt) * 100 : 0) }'
}

temp_c() {
    if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
        awk '{ printf "%.1f", $1 / 1000 }' /sys/class/thermal/thermal_zone0/temp
    else
        echo null
    fi
}

# Монітор. Кіоск може малювати бездоганно в порожнечу: екран вимкнули,
# від'єднали чи він сам пішов у сон — знати про це треба здалеку (прохання
# власника 23.09.2026). tvservice показує стан HDMI, vcgencmd — чи взагалі
# подається живлення на вихід; беремо перше, що є в системі.
monitor_on() {
    if command -v tvservice >/dev/null 2>&1; then
        _s=$(tvservice -s 2>/dev/null) || { echo null; return; }
        case "$_s" in
            "")            echo null ;;
            *"TV is off"*) echo false ;;
            *)             echo true ;;
        esac
        return
    fi
    if command -v vcgencmd >/dev/null 2>&1; then
        case "$(vcgencmd display_power 2>/dev/null)" in
            *=1) echo true ;;
            *=0) echo false ;;
            *)   echo null ;;
        esac
        return
    fi
    echo null
}

# Відеопотік. Камери на точці ще немає: поки в config/env немає CAMERA_URL,
# це чесне false — потоку нема, і саме так це має лежати в історії, а не
# «невідомо» (прохання власника 23.09.2026).
video_ok() {
    [ -n "${CAMERA_URL:-}" ] || { echo false; return; }
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 4 -o /dev/null "$CAMERA_URL" >/dev/null 2>&1 && echo true || echo false
        return
    fi
    echo null
}

mem_used_mb() { awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{ printf "%.0f", (t-a)/1024 }' /proc/meminfo; }
uptime_s()    { awk '{ printf "%.0f", $1 }' /proc/uptime; }
disk_free_mb() { df -Pm "$EXTROVERT_ROOT" 2>/dev/null | awk 'NR==2 { print $4 }'; }

# Мережа: ping до самого api — він же й показує, чи взагалі є інтернет.
# jitter рахуємо як середнє відхилення (mdev у виводі ping).
net_metrics() {
    _out=$(ping -c 5 -w 10 "$PING_HOST" 2>/dev/null) || { echo "null null 100"; return; }
    _loss=$(printf '%s\n' "$_out" | awk -F'[ %]' '/packet loss/{ for(i=1;i<=NF;i++) if($i=="packet") print $(i-2) }')
    _rtt=$(printf '%s\n' "$_out" | awk -F'/' '/rtt|round-trip/{ printf "%.1f %.1f", $5, $7 }')
    [ -z "$_rtt" ] && _rtt="null null"
    echo "$_rtt ${_loss:-0}"
}

# Кіоск сам розповідає про себе через UNIX-сокет (telemetry.c). Беремо fps
# і версію: саме вони кажуть, чи малюється меню.
kiosk_metrics() { # kiosk_metrics <сокет>
    _json=$(telemetry_read "$1" 2>/dev/null) || { echo "null null"; return; }
    # Ключі — рівно ті, що віддає telemetry.c: fps_avg і frames_total.
    # Скрипт шукав "fps" і "frames", яких у відповіді немає, тож у базу
    # їхало null навіть при кіоску, що малює свої 60 кадрів (23.09.2026).
    _fps=$(printf '%s' "$_json" | sed -n 's/.*"fps_avg"[ :]*\([0-9.]*\).*/\1/p')
    _frames=$(printf '%s' "$_json" | sed -n 's/.*"frames_total"[ :]*\([0-9]*\).*/\1/p')
    echo "${_fps:-null} ${_frames:-null}"
}

sample_json() {
    _cpu=$(cpu_percent); _temp=$(temp_c); _mem=$(mem_used_mb); _up=$(uptime_s); _disk=$(disk_free_mb)
    set -- $(net_metrics); _ping=$1; _jitter=$2; _loss=$3
    set -- $(kiosk_metrics "/tmp/kiosk-$(cat "$EXTROVERT_STATE/slot.kiosk" 2>/dev/null || echo 0).sock")
    _fps=$1; _frames=$2
    _monitor=$(monitor_on)
    _video=$(video_ok)
    _release=$(basename "$(readlink -f "$EXTROVERT_CURRENT" 2>/dev/null)" 2>/dev/null)
    _now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{"source":"pi","measured_at":"%s","idem_key":"pi:%s","metrics":{"cpu":%s,"temp_c":%s,"mem_used_mb":%s,"uptime_s":%s,"disk_free_mb":%s,"ping_ms":%s,"jitter_ms":%s,"loss_pct":%s,"kiosk_fps":%s,"kiosk_frames":%s,"monitor_on":%s,"video_ok":%s,"release":"%s"}}' \
        "$_now" "$_now" "${_cpu:-null}" "${_temp:-null}" "${_mem:-null}" "${_up:-null}" "${_disk:-null}" \
        "${_ping:-null}" "${_jitter:-null}" "${_loss:-null}" "${_fps:-null}" "${_frames:-null}" \
        "${_monitor:-null}" "${_video:-null}" "${_release:-unknown}"
}

# ── відправка ────────────────────────────────────────────────────────────
# Шлемо пачкою: усе, що в черзі, плюс свіжа проба. Вийшло — черга чиста.
send_queue() {
    [ -s "$QUEUE" ] || return 0
    [ -f "$TOKEN_FILE" ] || return 1
    _body=$(awk 'BEGIN{ printf "{\"samples\":[" } { printf "%s%s", (NR>1 ? "," : ""), $0 } END{ print "]}" }' "$QUEUE")
    _code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
        -H "authorization: Bearer $(cat "$TOKEN_FILE")" \
        -H 'content-type: application/json' \
        -X POST "$API/points/$POINT/telemetry" -d "$_body" 2>/dev/null) || _code=000
    case "$_code" in
        2*) _n=$(wc -l < "$QUEUE"); : > "$QUEUE"; log "надіслано проб: $_n"; return 0 ;;
        401|403) log "токен точки не приймають ($_code) — телеметрія чекає"; return 1 ;;
        *) log "не вийшло надіслати ($_code), лишаємо в черзі"; return 1 ;;
    esac
}

queue_push() {
    printf '%s\n' "$1" >> "$QUEUE"
    # Хвіст черги дорожчий за її початок: якщо точка мовчала тиждень, свіже
    # цікавіше за позавчорашнє.
    _lines=$(wc -l < "$QUEUE")
    if [ "$_lines" -gt "$QUEUE_MAX" ]; then
        tail -n "$QUEUE_MAX" "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
    fi
}

mkdir -p "$EXTROVERT_STATE"
log "телеметрія піднялась: кожні ${PERIOD}с у $API"

while [ "$STOPPING" -eq 0 ]; do
    if [ -f "$TOKEN_FILE" ]; then
        queue_push "$(sample_json)"
        send_queue || true
    else
        log "немає $TOKEN_FILE — пропускаємо прохід"
    fi
    _left="$PERIOD"
    while [ "$_left" -gt 0 ] && [ "$STOPPING" -eq 0 ]; do
        sleep 1
        _left=$((_left - 1))
    done
done

log "зупиняємось"
