#!/bin/sh
# recorder.sh — безперервний запис камери точки на USB-флешку
# (docs/video.md, «Запис»). Компонент стеку (components.conf): приїжджає
# релізом, піднімається супервізором.
#
# RTSP → `ffmpeg -c copy` → хвилинні сегменти Matroska (.mkv) з відео й
# звуком. Ні декодування, ні кодування, ні накладень: лише перекладання вже
# стиснених пакетів. Звук камери — pcm_alaw, і MPEG-TS його без перекодування
# не тримає (доріжка стає «bin_data»), а mkv тримає як є (власник,
# 07.10.2026: звук зберігаємо). Обрізаний знеструмленням mkv читається до
# місця обриву, як і TS (перевірено: 60 % файла — 60 % кадрів).
# Вивантаження в R2 — окремий компонент uploader.sh; він же стирає залите.
# Флешка — буфер на випадок, коли інтернету чи api немає (з 15.10.2026
# сегмент спершу лягає в RAM, див. RAM нижче): місця мало —
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

# ── Спершу в RAM, на флешку — лише запас (15.10.2026) ────────────────────
# Шина Pi 1 одна на все — Ethernet (потік камери), Wi-Fi (заливка) і флешка,
# — і з 15.10.2026 вона в режимі USB 1.1 (~8–9 Мбіт/с на практиці). Сегмент,
# записаний на флешку, проходив шиною тричі: з камери, на флешку, з флешки
# в аплоудер — і ще раз у Wi-Fi. Тому ffmpeg пише в tmpfs, аплоудер бере
# звідти в першу чергу, і на флешку сегмент потрапляє, лише коли заливка не
# встигає: у RAM лишаються RAM_KEEP найсвіжіших готових, старші ram_spill
# переносить на флешку. Знеструмлення забирає те, що лежало в RAM, — у
# штатному ритмі це поточний сегмент і ще щонайбільше один (аплоудер
# забирає готовий за хвилину), а коли інтернету немає — RAM_KEEP хвилин.
# Порожній RECORDER_RAM — пишемо прямо на флешку, як до 15.10.2026.
RAM="${RECORDER_RAM-/dev/shm/extrovert-video}"
RAM_KEEP="${RECORDER_RAM_KEEP:-3}"   # скільки готових сегментів тримати в RAM
# Аварійна межа: стільки готових у RAM — і найстаріші стираються. Буває,
# лише коли перенос на флешку не встигає чи висить (мертва флешка): без
# межі tmpfs з'їв би памʼять малини разом із кіоском (~5 МБ на хвилину).
RAM_MAX="${RECORDER_RAM_MAX:-8}"
# 1 — пишемо всі доріжки камери (відео й звук), 0 — лише відео. У 0
# recorder переходить сам, якщо ffmpeg відмовився писати звук у mkv
# (перевірено на ffmpeg 5.1, а на малині 3.2 — лише після першого запуску),
# і лишається в ньому до перезапуску компонента: запис без звуку кращий,
# ніж жодного.
AUDIO=1

STOPPING=0
FF=""
on_term() { STOPPING=1; [ -n "$FF" ] && kill "$FF" 2>/dev/null; }
trap on_term TERM INT

# Пауза, яка реагує на SIGTERM: супервізор гасить компоненти ґречно.
idle() { [ "$STOPPING" = 0 ] && nap "$1"; }   # одним sleep, див. nap у common.sh

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
    # Перебираємо підмережі всіх інтерфейсів, крім петлі й Wi-Fi, а не того,
    # куди веде default. З 14.10.2026 default іде через Wi-Fi клубу
    # (wifi.sh), а камера лишилась у мережі роутера LTE на eth0: після ребуту
    # з порожнім ARP-кешем рекордер чесав пінгами мережу клубу, камери там не
    # знаходив, і ~2 години запису не було. Чужу мережу клубу не чешемо й
    # тепер.
    for _cidr in $(ip -4 -o addr show 2>/dev/null | awk '$2 != "lo" && $2 !~ /^wlan/ { print $4 }'); do
        case "$_cidr" in */24) ;; *) continue ;; esac
        _base=${_cidr%.*}
        _i=1
        while [ "$_i" -le 254 ]; do
            ping -c 1 -W 1 "$_base.$_i" >/dev/null 2>&1 &
            [ $((_i % 32)) -eq 0 ] && wait
            _i=$((_i + 1))
        done
        wait
        _ip=$(arp_lookup "$_mac")
        [ -n "$_ip" ] && { echo "$_ip"; return; }
    done
}

# Запис по колу: стираємо найстаріші за часом зміни, доки вільного не стане
# KEEP_FREE_MB. Саме за часом, а не за абеткою: до 06.10.2026 імена були в
# місцевому часі, тепер в UTC із Z, і за абеткою вони б перемішались.
FULL_LOGGED=0
prune() {
    while :; do
        _free=$(df -Pm "$BUF" 2>/dev/null | awk 'NR == 2 { print $4 }')
        [ -n "$_free" ] && [ "$_free" -lt "$KEEP_FREE_MB" ] || return 0
        _old=$(ls -1tr "$DIR"/*.ts "$DIR"/*.mkv 2>/dev/null | head -n 1)
        [ -n "$_old" ] || return 0
        rm -f "$_old"
        if [ "$FULL_LOGGED" = 0 ]; then FULL_LOGGED=1; log "флешка заповнилась — далі пишемо по колу, стираючи найстаріше"; fi
    done
}

# Вік найсвіжішого сегмента там, куди зараз пише ffmpeg ($OUT). Найсвіжіший
# — останній за абеткою (імена — час запису в UTC), тож глоб, а не `ls -t`
# зі stat кожному з сотень файлів черги.
newest_age() {
    _f=""
    for _g in "$OUT"/*.mkv; do [ -e "$_g" ] && _f=$_g; done
    [ -n "$_f" ] || { echo 999999; return; }
    echo $(( $(date +%s) - $(stat -c %Y "$_f" 2>/dev/null || echo 0) ))
}

# ram_spill [all] — готові сегменти з RAM на флешку, крім RAM_KEEP
# найсвіжіших і того, який саме заливає аплоудер (state/upload.current).
# Найновіший файл у RAM не чіпаємо: у нього ще пише ffmpeg (з «all» —
# чіпаємо, ffmpeg уже зупинений). Копія йде під тимчасовим іменем, що не
# закінчується на .mkv, і лише потім стає сегментом: аплоудер не візьме
# недописаний, а `cp -p` лишає час зміни, за яким prune стирає найстаріше.
# Переносить фоновий процес по одному за раз: повільна чи зависла флешка
# (USB 1.1, а 12.10.2026 вона висла в ядрі намертво) не має зупиняти
# нагляд за ffmpeg і аварійну межу RAM_MAX.
SPILL_PID=""
RAM_FULL_LOGGED=0
ram_spill() {
    [ -n "$RAM" ] && [ -d "$RAM" ] || return 0
    _mode=${1:-}
    set --
    for _g in "$RAM"/*.mkv; do [ -e "$_g" ] && set -- "$@" "$_g"; done
    _n=$#
    [ "$_mode" = all ] || _n=$((_n - 1))   # найновіший — у нього ще пише ffmpeg
    # Повідомлення про переповнення — раз на епізод: знову можна, коли RAM
    # повернулась до норми (а не після кожної спроби переносу, що не вдалась).
    [ "$_n" -le "$RAM_KEEP" ] && RAM_FULL_LOGGED=0
    [ "$_n" -gt 0 ] || return 0
    _cur=""; { read -r _cur < "$EXTROVERT_STATE/upload.current"; } 2>/dev/null   # без процесу
    # Аварійна межа — до переносу і незалежно від нього.
    if [ "$_n" -gt "$RAM_MAX" ]; then
        _drop=$((_n - RAM_MAX))
        for _g in "$@"; do
            [ "$_drop" -gt 0 ] || break
            rm -f "$_g"; _drop=$((_drop - 1)); _n=$((_n - 1))
            shift
        done
        if [ "$RAM_FULL_LOGGED" = 0 ]; then
            RAM_FULL_LOGGED=1
            log "у RAM понад $RAM_MAX готових сегментів, а на флешку вони не йдуть — стираю найстаріші"
        fi
    fi
    if [ -n "$SPILL_PID" ] && kill -0 "$SPILL_PID" 2>/dev/null; then return 0; fi
    SPILL_PID=""
    _keep=$RAM_KEEP; [ "$_mode" = all ] && _keep=0
    _list=""; _i=0
    for _g in "$@"; do
        _i=$((_i + 1))
        [ "$_i" -le $((_n - _keep)) ] || break
        [ "$_g" = "$_cur" ] && continue
        _list="$_list $_g"
    done
    [ -n "$_list" ] || return 0
    # shellcheck disable=SC2086 # імена сегментів — без пробілів
    ( for _g in $_list; do
          _b=${_g##*/}
          cp -p "$_g" "$DIR/.$_b.part" && mv -f "$DIR/.$_b.part" "$DIR/$_b" && rm -f "$_g" \
              || { rm -f "$DIR/.$_b.part"; exit 1; }
      done ) </dev/null >/dev/null 2>&1 &
    SPILL_PID=$!
}

OUT=$DIR
log "старт, буфер $DIR${RAM:+, спершу в RAM ($RAM, готових до $RAM_KEEP)}"
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
    # Куди пише ffmpeg (RAM, див. угорі). Теки в tmpfs не вийшло — прямо на
    # флешку, як до 15.10.2026.
    OUT=$DIR
    if [ -n "$RAM" ]; then
        if mkdir -p "$RAM" 2>/dev/null; then OUT=$RAM; else say "не вдалось створити $RAM — пишу прямо на флешку"; fi
    fi

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
    # -map 0 -c copy — усі доріжки камери як є: відео й звук (-map 0:v —
    # лише відео, див. AUDIO). nice/ionice — запис не має права придушити
    # кіоск (video.md): кіоск — шлях до грошей, запис ні.
    _map="-map 0"; [ "$AUDIO" = 1 ] || _map="-map 0:v"
    # shellcheck disable=SC2086
    # Імена — час початку в UTC із Z: місцевий час на переході на літній
    # дає дві однакові години, а uploader рахує з імені час сегмента.
    TZ=UTC nice -n 10 ionice -c 3 ffmpeg -nostdin -loglevel warning \
        $_rt -use_wallclock_as_timestamps 1 \
        -i "$_url" \
        $_map -c copy \
        -f segment -segment_time "$SEGMENT_S" -reset_timestamps 1 -segment_format matroska \
        -strftime 1 "$OUT/%Y%m%dT%H%M%SZ.mkv" 2> "$FFLOG" &
    FF=$!

    # Нагляд щоп'ять секунд (ffmpeg, що впав одразу, не має чекати пів
    # хвилини; щосекундний sleep до 15.10.2026 коштував процес на секунду),
    # прибирання щопів хвилини, а якщо новий сегмент не з'являвся три
    # інтервали поспіль — потік завис (камера рве його сама), гасимо.
    _started=$(date +%s)
    _tick=0
    while [ "$STOPPING" = 0 ] && kill -0 "$FF" 2>/dev/null; do
        nap 5
        _tick=$((_tick + 5))
        # Після серії збоїв — один рядок, що запис знову йде: інакше в лозі
        # видно лише початок збою, а не його кінець.
        if [ "${FAILS:-0}" -gt 0 ] && [ "$_tick" -ge $((SEGMENT_S * 2)) ]; then
            log "запис відновився після $FAILS невдалих спроб"
            FAILS=0; LAST="пишу з $(printf '%s' "$_url" | mask)"
        fi
        [ $((_tick % 30)) -eq 0 ] || continue
        prune
        ram_spill
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
    fi
    # Потік камера віддала, а mkv не прийняв доріжку — це про звук, а не про
    # мережу: далі пишемо лише відео й пробуємо одразу, без паузи.
    if [ "$AUDIO" = 1 ] && [ "${FAILS:-0}" -gt 0 ] &&
        grep -qiE 'could not write header|codec tag|not supported|matches no streams' "$FFLOG" 2>/dev/null; then
        AUDIO=0; FAILS=0; LAST=""
        log "звук у mkv не пишеться — далі пишу лише відео (до перезапуску компонента)"
        idle 2; continue
    fi
    if [ "${FAILS:-0}" -eq 2 ]; then
        log "камера не віддає потік — пробую далі, рідше, без повторів у лозі"
    fi
    _wait=5
    _n=1
    while [ "$_n" -lt "${FAILS:-1}" ] && [ "$_wait" -lt 60 ]; do _wait=$((_wait * 2)); _n=$((_n + 1)); done
    [ "$_wait" -gt 60 ] && _wait=60
    idle "$_wait"
done
# Зупинка: ffmpeg уже дописав свій сегмент — усе з RAM на флешку, скільки
# встигнемо до SIGKILL супервізора (STOP_GRACE_S): після ребуту tmpfs порожній,
# а перезапуск компонента — це часто саме ребут.
if [ -n "$SPILL_PID" ]; then wait "$SPILL_PID" 2>/dev/null; SPILL_PID=""; fi
ram_spill all
[ -n "$SPILL_PID" ] && wait "$SPILL_PID" 2>/dev/null
log "зупинено"
