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
# Хвилина, а не пʼять: від цього періоду напряму залежить, за скільки ми
# дізнаємось, що точка впала (overseer бачить мовчання через SILENT_MINUTES).
# Проба — це кілька кілобайт і секунди очікування мережі, не рахунок за
# трафік (прохання власника прискорити сповіщення, 24.09.2026).
PERIOD="${TELEMETRY_PERIOD_S:-60}"
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
# власника 23.09.2026).
#
# ⚠️ Чесно про межі методу (24.09.2026, після того як власник вимкнув монітор
# кнопкою, а телеметрія далі казала «увімкнено»). По HDMI видно РІВНО три
# речі, і жодна з них не про кнопку на моніторі:
#   tvservice -s      — що ВИДАЄ малина (у нас ще й hdmi_force_hotplug=1,
#                       тож вона видає сигнал навіть у нікуди);
#   tvservice -n      — чи читається EDID, тобто чи є на тому кінці пристрій;
#   cec pow           — питання «ти увімкнений?» самому монітору.
# Монітор у standby зазвичай тримає і hotplug, і EDID — від увімкненого його
# не відрізнити нічим, крім CEC. Тому чесна відповідь така: CEC, якщо він є,
# інакше EDID (ловить від'єднаний кабель і знеструмлений монітор), інакше
# null — «не знаємо», а не «увімкнено».
#
# Перевірено на живому залізі 24.09.2026, монітор Asus VP227HF: коли його
# вимикають кнопкою, `tvservice -s` далі каже «HDMI CEA (16) 1920x1080», а
# `tvservice -n` спокійно віддає device_name=AUS-VP227HF. І лише CEC каже
# правду: `power status: standby`. Він же вміє його ввімкнути назад.
monitor_on() {
    # CEC: єдиний спосіб дізнатись про standby. Питаємо пристрій 0 (телевізор).
    if command -v cec-client >/dev/null 2>&1; then
        _p=$(echo "pow 0" | timeout 12 cec-client -s -d 1 2>/dev/null | grep -i "power status:")
        case "$_p" in
            *"power status: on"*) echo true;  return ;;
            *standby*)            echo false; return ;;
        esac
    fi
    # EDID читається — пристрій на тому кінці є (хоч, можливо, і в сні).
    if command -v tvservice >/dev/null 2>&1; then
        _n=$(tvservice -n 2>/dev/null)
        case "$_n" in
            *device_name*) echo true;  return ;;
            *)             echo false; return ;;
        esac
    fi
    echo null
}

# Звідки взялася відповідь monitor_on: без цього «true» з EDID і «true» з CEC
# виглядають однаково, а вартують вони різного.
monitor_source() {
    if command -v cec-client >/dev/null 2>&1; then echo cec; return; fi
    if command -v tvservice   >/dev/null 2>&1; then echo edid; return; fi
    echo none
}

# Розбудити монітор. Кіоск існує, щоб на нього дивились, тож екран у сні —
# поломка, яку ми вміємо полагодити самі (у списку власника це «вимкнуто
# монітор → перезапуск монітора»).
#
# Будимо на КОЖНІЙ пробі, де побачили сон, без пауз між спробами (рішення
# власника 24.09.2026). Вимикається одним MONITOR_AUTOWAKE=0 у config/env —
# це і є спосіб лишити екран темним навмисно.
#
# Проба при цьому однаково піде як «монітор вимкнено»: інакше в історії не
# лишилось би й сліду, а власник хотів бачити рівно одне таке спостереження
# на кожен випадок.
#
# Окремого швидкого циclу опитування свідомо немає: один опит CEC коштує
# 5,7 с (заміряно на точці), і ганяти його щопівхвилини на Pi 1 — це віднімати
# час у кіоска. Якщо колись знадобиться реакція за секунди, дешевий шлях уже
# перевірений: тримати cec-client відкритим через fifo — тоді один запит
# коштує 50–230 мс замість 5,7 с.
monitor_wake() {
    [ "${MONITOR_AUTOWAKE:-1}" = "1" ] || return 1
    command -v cec-client >/dev/null 2>&1 || return 1
    # У stderr, а не в stdout: цю функцію викликає sample_json усередині
    # $(...), і будь-який рядок у stdout поїхав би в тіло проби. Саме так
    # 24.09.2026 телеметрія почала слати битий JSON і ловити 500.
    log "монітор у сні — вмикаємо через CEC" >&2
    echo "on 0" | timeout 12 cec-client -s -d 1 >/dev/null 2>&1
    return 0
}

# Стан живлення прошивки: 0x1 — просідає прямо зараз, 0x10000 — просідало з
# моменту завантаження. Саме воно малює той «райдужний квадрат» у кутку, і
# воно ж — головна причина, чому вмирають SD-карти: запис під час просідання
# псує файлову систему (docs/raspberry-pi.md). Пишемо число як є: розбирати
# біти зручніше на сервері, ніж у sh.
throttled() {
    if command -v vcgencmd >/dev/null 2>&1; then
        _t=$(vcgencmd get_throttled 2>/dev/null)
        case "$_t" in
            throttled=0x*) printf '%d' "$(printf '%s' "${_t#throttled=}")" 2>/dev/null || echo null ;;
            *) echo null ;;
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

# Картка стала read-only. Ядро робить так само мовчки, коли ловить помилки
# запису, — і далі все «працює», доки не знадобиться щось записати: оновлення
# не встановиться, черга телеметрії не збережеться, стан кіоска не ляже. Це
# один із найпідступніших відмов, бо екран при цьому малює як завжди.
root_readonly() {
    if grep -q " / .*[( ,]ro[ ,)]" /proc/mounts 2>/dev/null; then echo true; return; fi
    # Перевірка ділом: mount може казати rw, а запис уже не проходити.
    _probe="$EXTROVERT_STATE/.rw-probe"
    if ( : > "$_probe" ) 2>/dev/null; then rm -f "$_probe"; echo false; else echo true; fi
}

# Флешка під запис відео (video.md): точка монтування має бути змонтована й
# писатись. Немає USB — немає й буфера запису, а дізнаємось ми про це зараз,
# а не коли знадобиться архів.
usb_ok() {
    _mnt="${RECORDER_BUF:-}"
    [ -n "$_mnt" ] || { echo null; return; }
    grep -q " $_mnt " /proc/mounts 2>/dev/null || { echo false; return; }
    _probe="$_mnt/.rw-probe"
    if ( : > "$_probe" ) 2>/dev/null; then rm -f "$_probe"; echo true; else echo false; fi
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
    _msrc=$(monitor_source)
    # Побачили сон — одразу пробуємо розбудити, і кажемо про це в пробі:
    # інакше «монітор вимкнено» і «монітор вимкнено, але ми його ввімкнули»
    # виглядали б однаково.
    _woke=false
    if [ "$_monitor" = "false" ] && monitor_wake; then _woke=true; fi
    _video=$(video_ok)
    _throttled=$(throttled)
    _rofs=$(root_readonly)
    _usb=$(usb_ok)
    _release=$(basename "$(readlink -f "$EXTROVERT_CURRENT" 2>/dev/null)" 2>/dev/null)
    _now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{"source":"pi","measured_at":"%s","idem_key":"pi:%s","metrics":{"cpu":%s,"temp_c":%s,"mem_used_mb":%s,"uptime_s":%s,"disk_free_mb":%s,"ping_ms":%s,"jitter_ms":%s,"loss_pct":%s,"kiosk_fps":%s,"kiosk_frames":%s,"monitor_on":%s,"monitor_src":"%s","monitor_woke":%s,"video_ok":%s,"throttled":%s,"root_ro":%s,"usb_ok":%s,"release":"%s"}}' \
        "$_now" "$_now" "${_cpu:-null}" "${_temp:-null}" "${_mem:-null}" "${_up:-null}" "${_disk:-null}" \
        "${_ping:-null}" "${_jitter:-null}" "${_loss:-null}" "${_fps:-null}" "${_frames:-null}" \
        "${_monitor:-null}" "${_msrc:-none}" "${_woke:-false}" "${_video:-null}" "${_throttled:-null}" \
        "${_rofs:-null}" "${_usb:-null}" "${_release:-unknown}"
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
        # 400 — сервер не зміг це прочитати, і завтра теж не зможе. Тримати
        # такий пакет вічно означає зупинити телеметрію назавжди; краще
        # втратити ці проби, ніж усі наступні.
        400) _n=$(wc -l < "$QUEUE"); : > "$QUEUE"; log "сервер не прийняв пакет (400) — викидаю $_n проб, щоб не стояла черга"; return 1 ;;
        *) log "не вийшло надіслати ($_code), лишаємо в черзі"; return 1 ;;
    esac
}

queue_push() {
    # Кладемо лише те, що схоже на пробу: один рядок JSON-обʼєкта. Один чужий
    # рядок отруює ВЕСЬ пакет — сервер відповідає помилкою на всю чергу, і
    # телеметрія стоїть, доки хтось не почистить файл руками. Саме так
    # 24.09.2026 лог, що втік у stdout, зупинив проби з точки.
    case "$1" in
        '{'*'}') : ;;
        *) log "проба не схожа на JSON — у чергу не кладу"; return 1 ;;
    esac
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
