#!/bin/sh
# common.sh — спільне для supervisor.sh і updater.sh. Підключається через
# `. "$(dirname "$0")/common.sh"`, власного main() не має.
#
# POSIX sh, не bash: на малині є обидва, але скрипти стеку мають лишатись
# перевіряємими в busybox/dash, якщо колись знадобиться менший образ.

# ── Розкладка ────────────────────────────────────────────────────────────
# Усе наше живе під одним коренем. Поза ним — лише systemd-юніт (його
# інсталює install.sh один раз і більше ніколи не чіпає).
EXTROVERT_ROOT="${EXTROVERT_ROOT:-/home/pi/extrovert}"
EXTROVERT_STATE="${EXTROVERT_STATE:-$EXTROVERT_ROOT/state}"
EXTROVERT_LOGS="${EXTROVERT_LOGS:-$EXTROVERT_ROOT/logs}"
EXTROVERT_RELEASES="$EXTROVERT_ROOT/releases"
EXTROVERT_CURRENT="$EXTROVERT_ROOT/current"
export EXTROVERT_ROOT EXTROVERT_STATE

# Конфіг точки. Лежить у config/, а не в $HOME — щоб "усе наше в одній
# теці" виконувалось буквально й бекап теки був самодостатнім.
[ -f "$EXTROVERT_ROOT/config/env" ] && . "$EXTROVERT_ROOT/config/env"

POINT="${POINT:-kyiv-01}"
UPDATE_URL="${UPDATE_URL:-https://pos.extrovert.cafe/releases/pi/manifest.json}"
# Дві хвилини, а не пʼятнадцять (25.09.2026). CI не має як штовхнути точку:
# вона за роутером у локальній мережі, і достукатись до неї ззовні не можна —
# ходить тільки вона сама. Тому єдине, що керує затримкою «задеплоїли →
# приїхало на точку», це період опитування, а коштує воно нічого:
# маніфест питається з If-None-Match і без змін віддає 304 на пару сотень
# байтів. Пʼятнадцять хвилин очікування були платою ні за що.
UPDATE_PERIOD_S="${UPDATE_PERIOD_S:-120}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"

log() {
    # Один формат на всі процеси стеку: дата, хто, що. Пишемо в stdout —
    # перенаправленням керує той, хто запустив (supervisor або systemd).
    printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${LOG_TAG:-stack}" "$*"
}

die() { log "ФАТАЛЬНО: $*"; exit 1; }

# nap <секунд> — почекати одним sleep, а не посекундно (15.10.2026).
# Компоненти чекали циклом `sleep 1`, щоб SIGTERM не чекав хвилинами, —
# і кожна секунда очікування коштувала fork+exec: на Pi 1 з усіма
# компонентами це ~7 процесів на секунду лише на те, щоб нічого не робити.
# `wait` на фоновому sleep переривається сигналом, для якого стоїть trap
# (POSIX), тож зупинка й так миттєва. sleep, що лишився, добиваємо лише
# тоді, коли wait перервали (код ≠ 0): той, що доспав сам, уже прибраний, і
# його номер міг би дістатись іншому процесу.
nap() {
    sleep "$1" &
    _nap=$!
    wait "$_nap" 2>/dev/null || kill "$_nap" 2>/dev/null
    return 0
}

# ── Читання плаского JSON без jq ─────────────────────────────────────────
# jq на Stretch ставиться з архівних репозиторіїв, але залежність, без якої
# оновлення не поїде, — поганий обмін на зручність. Маніфест генеруємо ми
# самі (make-release.sh), він навмисно ПЛАСКИЙ і без вкладених обʼєктів,
# тому grep тут не евристика, а розбір відомого формату.
json_get() { # json_get <файл> <ключ>
    grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null \
        | head -n1 | sed 's/.*:[[:space:]]*"//; s/"$//'
}
json_get_num() { # json_get_num <файл> <ключ>
    grep -o "\"$2\"[[:space:]]*:[[:space:]]*[0-9][0-9]*" "$1" 2>/dev/null \
        | head -n1 | sed 's/.*:[[:space:]]*//'
}

# ── Телеметрія кіоска ────────────────────────────────────────────────────
# Читає JSON із UNIX-сокета кіоска (telemetry.c) — одним викликом nc -U
# (netcat-openbsd, він у нашому образі). Не відповів — повертаємо 1, і проба
# піде без fps: це краще, ніж добивати процесор.
#
# До 15.10.2026 тут був запасний шлях через python3 (на випадок nc без -U)
# і подвійне читання (перевірка, потім те саме ще раз). python3 вмикався
# саме тоді, коли nc не встигав, тобто коли процесор Pi 1 був на 100 %, — і
# його старт коштував ще ~1 с CPU зверху; в top він так і маячив.
telemetry_read() { # telemetry_read <шлях-сокета>
    [ -S "$1" ] || return 1
    command -v nc >/dev/null 2>&1 || return 1
    # timeout обовʼязковий: кіоск, що завис у кадрі, лишає сокет у listen, і
    # ядро приймає зʼєднання й без нього — nc тоді чекав би відповіді вічно,
    # а разом із ним і телеметрія (12.10.2026). 5 с, а не 3: на зайнятому
    # процесорі кіоск відповідає й за 1–3 с, і проба без fps була б зайвою.
    _tr=$(timeout 5 nc -U "$1" 2>/dev/null | head -n1)
    case "$_tr" in *fps*) printf '%s\n' "$_tr"; return 0 ;; esac
    return 1
}

# «Живий» = сокет відповідає і кадри реально йдуть. Перевіряти лише
# наявність процесу мало: постмортем 18.08.2026 — процес був живий і
# логи чисті, а на екрані білий фон.
telemetry_healthy() { # telemetry_healthy <шлях-сокета>
    _t=$(telemetry_read "$1") || return 1
    [ -n "$_t" ] || return 1
    _frames=$(printf '%s' "$_t" | grep -o '"frames_total"[[:space:]]*:[[:space:]]*[0-9]*' | sed 's/.*://')
    [ -n "$_frames" ] && [ "$_frames" -gt 0 ] 2>/dev/null
}

state_write() { # state_write <імʼя-файла> <вміст>
    mkdir -p "$EXTROVERT_STATE"
    printf '%s\n' "$2" > "$EXTROVERT_STATE/$1.tmp" && mv -f "$EXTROVERT_STATE/$1.tmp" "$EXTROVERT_STATE/$1"
}

current_release() {
    [ -L "$EXTROVERT_CURRENT" ] || { echo ""; return; }
    basename "$(readlink "$EXTROVERT_CURRENT")"
}

# ── Годинник ─────────────────────────────────────────────────────────────
#
# У Pi 1 немає RTC, тож після знеструмлення час бере fake-hwclock — а той
# пише свій файл у /etc, який під overlay лежить на read-only корені й
# замерз на даті образу (docs/raspberry-pi.md §5). Тобто механізм, який
# раніше рятував, з 25.09.2026 більше не працює: точка щоразу піднімається
# з тим самим часом із минулого, і розрив росте місяцями.
#
# Чим це погано насправді, окрім кривих графіків: з годинником у минулому
# HTTPS відмовляє — сертифікат «ще не дійсний» (raspberry/pi/fix-clock.sh
# описує це з натури), тобто точка не візьме ні меню, ні оновлення. Рятує
# NTP, але лише коли мережа вже є; до того моменту проби телеметрії лягають
# у чергу з брехливим measured_at.
#
# Тому тримаємо власну мітку на розділі data — єдиному, що переживає
# перезавантаження. Раз на хвилину записуємо час, АЛЕ лише підтверджений
# NTP: інакше одного разу збережений хибний час пінився б назавжди. На
# старті піднімаємо годинник до мітки, якщо він позаду. Це не заміна NTP, а
# те, що закриває вікно до його першої синхронізації.
CLOCK_MARK="${CLOCK_MARK:-$EXTROVERT_STATE/clock}"

# timedatectl ходить у systemd по D-Bus; зависла шина тримала б кожного, хто
# питає годинник (телеметрію щокола, супервізор щохвилини).
clock_ntp_ok() { timeout 5 timedatectl 2>/dev/null | grep -qi "NTP synchronized: *yes"; }

_clock_mark_read() {
    _m=$(cat "$CLOCK_MARK" 2>/dev/null) || _m=""
    case "$_m" in ""|*[!0-9]*) echo 0 ;; *) echo "$_m" ;; esac
}

clock_save() {
    clock_ntp_ok || return 0
    _now=$(date -u +%s)
    [ "$_now" -gt "$(_clock_mark_read)" ] || return 0   # мітка лише вперед
    printf '%s\n' "$_now" > "$CLOCK_MARK.tmp" && mv -f "$CLOCK_MARK.tmp" "$CLOCK_MARK"
}

clock_restore() {
    _mark=$(_clock_mark_read)
    [ "$_mark" -gt 0 ] || return 0
    _now=$(date -u +%s)
    [ "$_mark" -gt "$_now" ] || return 0
    _behind=$((_mark - _now))
    if sudo -n date -u -s "@$_mark" >/dev/null 2>&1; then
        log "годинник відставав на ${_behind}с — підняв до останньої відомої мітки"
    else
        log "годинник відставав на ${_behind}с, підняти не вдалось (sudo -n)"
    fi
}
