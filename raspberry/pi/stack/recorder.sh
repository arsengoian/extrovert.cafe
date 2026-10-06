#!/bin/sh
# recorder.sh — безперервний запис камери точки на USB-флешку
# (docs/video.md, «Запис»). Компонент стеку (components.conf): приїжджає
# релізом, піднімається супервізором.
#
# Пише те саме, що заміряли 17.08.2026: RTSP → `ffmpeg -c copy` → MPEG-TS
# хвилинними сегментами. Ні декодування, ні кодування, ні накладень: лише
# перекладання вже стиснених пакетів (4 % CPU на Pi 1, кіоск тримає fps).
# Вивантаження в R2 — окремий компонент uploader.sh; він же стирає залите.
# Флешка — буфер на випадок, коли інтернету чи api немає: місця мало —
# стираємо найстаріше.
#
# Камера (Tapo C100) — у config/camera.env, поза релізом: релізи лежать у
# публічному бакеті, а там логін і пароль «акаунта камери» з застосунку
# Tapo. Немає файла — компонент чекає й нічого не пише.
#   CAM_MAC=c0:3a:55:fc:7b:57    адресу камера бере по DHCP, тож шукаємо за MAC
#   CAM_USER=...                 акаунт камери (Tapo → Advanced Settings →
#   CAM_PASS=...                 Camera Account); будь-які символи, лапки не потрібні
#   CAM_IP=                      необов'язково — фіксована адреса замість пошуку
#   CAM_STREAM=stream1           stream1 — 1080p, stream2 — 360p
#   CAM_URL=                     необов'язково — повна адреса потоку замість
#                                усього вище (інша камера, перевірка на стенді)
set -u
LOG_TAG=recorder
. "$(dirname "$0")/common.sh"

CAM_ENV="$EXTROVERT_ROOT/config/camera.env"
BUF="${RECORDER_BUF-/mnt/buf}"
DIR="$BUF/video"
SEGMENT_S="${RECORDER_SEGMENT_S:-60}"
# Скільки лишати вільним на флешці. Сегмент — ~6 МБ (95 КБ/с × 60 с), тож
# 2 ГБ — запас на кілька годин, якщо прибирання раптом зупиниться.
KEEP_FREE_MB="${RECORDER_KEEP_FREE_MB:-2048}"
FFLOG=/tmp/recorder-ffmpeg.log

STOPPING=0
FF=""
on_term() { STOPPING=1; [ -n "$FF" ] && kill "$FF" 2>/dev/null; }
trap on_term TERM INT

# Пауза, яка реагує на SIGTERM: супервізор гасить компоненти ґречно.
idle() { _s=$1; while [ "$_s" -gt 0 ] && [ "$STOPPING" = 0 ]; do sleep 1; _s=$((_s - 1)); done; }

# Повідомлення про стан — лише коли стан змінився, інакше «камера не
# налаштована» писалось би в лог щокілька хвилин цілодобово.
LAST=""
say() { [ "$1" = "$LAST" ] && return; LAST=$1; log "$1"; }

# Пароль у логи не пускаємо: ffmpeg друкує адресу потоку разом з
# обліковими даними (rtsp://логін:пароль@…), тож маскуємо їх.
mask() { sed 's#://[^@/ ]*@#://***@#g'; }

# camera.env читаємо буквально, а не через `.`: пароль камери з символом $
# shell розгорнув би (06.10.2026 у логіні kyiv-01 стояло «$@», і логін
# тихо псувався). Лише відомі ключі; лапки довкола значення знімаються.
read_camera_env() {
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in '' | \#*) continue ;; esac
        _k=${_line%%=*}; _v=${_line#*=}
        case "$_v" in \'*\') _v=${_v#\'}; _v=${_v%\'} ;; \"*\") _v=${_v#\"}; _v=${_v%\"} ;; esac
        case "$_k" in CAM_MAC | CAM_USER | CAM_PASS | CAM_IP | CAM_STREAM | CAM_URL) eval "$_k=\$_v" ;; esac
    done < "$1"
}

# Логін і пароль в адресі потоку — з %-кодуванням: «@» інакше межує з
# хостом, «:» — з паролем. ffmpeg 3.2 на Stretch такі адреси розкодовує
# (перевірено на C100 kyiv-01, 06.10.2026).
urlenc() {
    _s=$1; _o=""
    while [ -n "$_s" ]; do
        _c=${_s%"${_s#?}"}; _s=${_s#?}
        case "$_c" in [a-zA-Z0-9._~-]) _o="$_o$_c" ;; *) _o="$_o$(printf '%%%02X' "'$_c")" ;; esac
    done
    printf '%s' "$_o"
}

arp_lookup() { ip neigh show | awk -v m="$1" 'tolower($5) == m && $1 ~ /\./ { print $1; exit }'; }

# Камеру шукаємо за MAC: спершу в ARP-таблиці, а якщо її там немає —
# пінгуємо підмережу, щоб таблиця заповнилась. Партіями по 32: 254 ping
# одночасно на Pi 1 поруч із кіоском — зайвий сплеск памʼяті.
find_camera() {
    _mac=$(printf '%s' "$CAM_MAC" | tr 'A-Z-' 'a-z:')
    _ip=$(arp_lookup "$_mac")
    [ -n "$_ip" ] && { echo "$_ip"; return; }
    _dev=$(ip -4 route show default | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
    _cidr=$(ip -4 -o addr show dev "$_dev" 2>/dev/null | awk '{ print $4; exit }')
    case "$_cidr" in */24) ;; *) return ;; esac
    _base=${_cidr%.*}
    _i=1
    while [ "$_i" -le 254 ]; do
        ping -c 1 -W 1 "$_base.$_i" >/dev/null 2>&1 &
        [ $((_i % 32)) -eq 0 ] && wait
        _i=$((_i + 1))
    done
    wait
    arp_lookup "$_mac"
}

# Запис по колу: стираємо найстаріші за часом зміни, доки вільного не стане
# KEEP_FREE_MB. Саме за часом, а не за абеткою: до 06.10.2026 імена були в
# місцевому часі, тепер в UTC із Z, і за абеткою вони б перемішались.
FULL_LOGGED=0
prune() {
    while :; do
        _free=$(df -Pm "$BUF" 2>/dev/null | awk 'NR == 2 { print $4 }')
        [ -n "$_free" ] && [ "$_free" -lt "$KEEP_FREE_MB" ] || return 0
        _old=$(ls -1tr "$DIR"/*.ts 2>/dev/null | head -n 1)
        [ -n "$_old" ] || return 0
        rm -f "$_old"
        if [ "$FULL_LOGGED" = 0 ]; then FULL_LOGGED=1; log "флешка заповнилась — далі пишемо по колу, стираючи найстаріше"; fi
    done
}

newest_age() {
    _f=$(ls -1t "$DIR"/*.ts 2>/dev/null | head -n 1)
    [ -n "$_f" ] || { echo 999999; return; }
    echo $(( $(date +%s) - $(stat -c %Y "$_f") ))
}

log "старт, буфер $DIR"
while [ "$STOPPING" = 0 ]; do
    if [ ! -f "$CAM_ENV" ]; then say "немає $CAM_ENV — камера не налаштована, чекаю"; idle 300; continue; fi
    CAM_MAC=""; CAM_USER=""; CAM_PASS=""; CAM_IP=""; CAM_STREAM=""; CAM_URL=""
    read_camera_env "$CAM_ENV"
    if [ -z "$CAM_URL" ] && { [ -z "$CAM_USER" ] || [ -z "$CAM_PASS" ]; }; then
        say "у camera.env немає CAM_USER чи CAM_PASS"; idle 300; continue
    fi
    # Без флешки не пишемо взагалі: корінь під overlay живе в RAM, і запис
    # у незмонтовану теку /mnt/buf за годину поклав би всю малину.
    if [ -z "$BUF" ] || ! grep -q " $BUF " /proc/mounts; then say "флешка $BUF не змонтована — без неї не пишу"; idle 120; continue; fi
    mkdir -p "$DIR" || { say "не вдалось створити $DIR"; idle 120; continue; }

    _url=$CAM_URL
    if [ -z "$_url" ]; then
        _ip=${CAM_IP:-}
        [ -n "$_ip" ] || { [ -n "$CAM_MAC" ] && _ip=$(find_camera); }
        if [ -z "$_ip" ]; then say "камеру ${CAM_MAC:-?} у мережі не знайдено"; idle 60; continue; fi
        _url="rtsp://$(urlenc "$CAM_USER"):$(urlenc "$CAM_PASS")@$_ip:554/${CAM_STREAM:-stream1}"
    fi
    # -rtsp_transport є лише в протоколу rtsp: для іншого джерела ffmpeg не
    # попереджає, а падає з «Option rtsp_transport not found» (rec-test.sh).
    _rt=""
    case "$_url" in rtsp://*) _rt="-rtsp_transport tcp" ;; esac

    prune
    say "пишу з $(printf '%s' "$_url" | mask)"
    # -an — без звуку: камера в публічному місці, а звук не потрібен ні
    # охороні, ні аналітиці (і це ще менше роботи — доріжку просто
    # відкидаємо). nice/ionice — запис не має права придушити кіоск
    # (video.md): кіоск — шлях до грошей, запис ні.
    # shellcheck disable=SC2086
    # Імена — час початку в UTC із Z: місцевий час на переході на літній
    # дає дві однакові години, а uploader рахує з імені час сегмента.
    TZ=UTC nice -n 10 ionice -c 3 ffmpeg -nostdin -loglevel warning \
        $_rt -use_wallclock_as_timestamps 1 \
        -i "$_url" \
        -an -c copy \
        -f segment -segment_time "$SEGMENT_S" -reset_timestamps 1 -segment_format mpegts \
        -strftime 1 "$DIR/%Y%m%dT%H%M%SZ.ts" 2> "$FFLOG" &
    FF=$!

    # Нагляд щосекунди (ffmpeg, що впав одразу, не має чекати пів хвилини),
    # прибирання щопів хвилини, а якщо новий сегмент не з'являвся три
    # інтервали поспіль — потік завис (камера рве його сама), гасимо.
    _started=$(date +%s)
    _tick=0
    while [ "$STOPPING" = 0 ] && kill -0 "$FF" 2>/dev/null; do
        sleep 1
        _tick=$((_tick + 1))
        # Після серії збоїв — один рядок, що запис знову йде: інакше в лозі
        # видно лише початок збою, а не його кінець.
        if [ "${FAILS:-0}" -gt 0 ] && [ "$_tick" -ge $((SEGMENT_S * 2)) ]; then
            log "запис відновився після $FAILS невдалих спроб"
            FAILS=0; LAST="пишу з $(printf '%s' "$_url" | mask)"
        fi
        [ $((_tick % 30)) -eq 0 ] || continue
        prune
        if [ $(( $(date +%s) - _started )) -gt $((SEGMENT_S * 3)) ] && [ "$(newest_age)" -gt $((SEGMENT_S * 3)) ]; then
            log "нових сегментів немає вже $((SEGMENT_S * 3)) с — перезапускаю ffmpeg"
            kill "$FF" 2>/dev/null
        fi
    done
    wait "$FF" 2>/dev/null; _rc=$?
    FF=""
    [ "$STOPPING" = 1 ] && break

    # Камера недоступна — повтори з паузою, що росте від 5 до 60 с, а рядки
    # помилки ffmpeg лише на початку серії: інакше вимкнена на ніч камера
    # засипала б лог однаковими повідомленнями кожні кілька секунд.
    if [ $(( $(date +%s) - _started )) -lt $((SEGMENT_S * 2)) ]; then
        FAILS=$(( ${FAILS:-0} + 1 ))
    else
        FAILS=0; LAST=""
    fi
    if [ "${FAILS:-0}" -le 1 ]; then
        log "ffmpeg вийшов (код $_rc); останні рядки:"
        tail -n 5 "$FFLOG" 2>/dev/null | mask | while IFS= read -r _l; do log "  ffmpeg: $_l"; done
    elif [ "$FAILS" -eq 2 ]; then
        log "камера не віддає потік — пробую далі, рідше, без повторів у лозі"
    fi
    _wait=5
    _n=1
    while [ "$_n" -lt "${FAILS:-1}" ] && [ "$_wait" -lt 60 ]; do _wait=$((_wait * 2)); _n=$((_n + 1)); done
    [ "$_wait" -gt 60 ] && _wait=60
    idle "$_wait"
done
log "зупинено"
