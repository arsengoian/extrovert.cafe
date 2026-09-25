#!/bin/sh
# supervisor.sh — єдиний процес, який systemd знає в обличчя. Підіймає й
# тримає живими всі наші процеси на точці.
#
# Чому не по systemd-юніту на компонент: додати компонент тоді означає
# правку в /etc/systemd (root, поза нашою текою). Тут новий компонент —
# це рядок у components.conf усередині релізу, тобто він приїжджає
# звичайним оновленням і не потребує нічого системного.
#
# Хто кого перезапускає: pid'ами володіє ЛИШЕ супервізор. Апдейтер не
# чіпає процеси сам — він кладе файл-запит у state/ і чекає. Інакше двоє
# процесів билися б за одну дитину, і `wait` в обох давав би різні
# відповіді про те, чи вона взагалі жива.

set -u
LOG_TAG=supervisor
. "$(dirname "$0")/common.sh"

COMPONENTS_CONF="$EXTROVERT_CURRENT/stack/components.conf"
WANT="$EXTROVERT_STATE/.want"
PIDS=""          # "імʼя:pid імʼя:pid ..."
STOPPING=0

on_term() { STOPPING=1; log "сигнал зупинки — гасимо компоненти"; stop_all; exit 0; }
trap on_term TERM INT

# ── Слоти шарів dispmanx ─────────────────────────────────────────────────
# Кіоск малює в dispmanx-шар. Щоб оновлення не давало чорного екрана, нова
# версія піднімається на СУСІДНЬОМУ шарі (вище), малює перший кадр, і лише
# тоді стара гаситься. Тому кожен overlap-компонент має «слот» 0 або 1:
# шар і власний telemetry-сокет, які чергуються між перезапусками.
slot_of() { # slot_of <імʼя>
    _f="$EXTROVERT_STATE/slot.$1"
    [ -f "$_f" ] && cat "$_f" 2>/dev/null || echo 0
}
slot_set() { printf '%s\n' "$2" > "$EXTROVERT_STATE/slot.$1"; }
sock_for() { echo "/tmp/kiosk-$2.sock"; }   # sock_for <імʼя> <слот>

component_env() { # component_env <імʼя> <слот>
    export EXTROVERT_STATE EXTROVERT_ROOT POINT
    export ASSETS="${ASSETS:-$EXTROVERT_CURRENT/assets}"
    export URL="${URL:-https://pos.extrovert.cafe/points/$POINT/menu.json}"
    export POPUP="${POPUP:-1}"
    export DISPMANX_LAYER="$2"
    export TELEMETRY_SOCK="$(sock_for "$1" "$2")"
    # Статичне меню для fbi (запасний варіант, docs/raspberry-pi.md §6):
    # кіоск перезаписує його сам, коли змінюється меню. У state/, бо це наша
    # тека і пишеться без root — і після overlay на корінь теж.
    export FALLBACK_PNG="${FALLBACK_PNG:-$EXTROVERT_STATE/menu.png}"
    # Події точки (ws.c). config/env підключається без export, тож без цих
    # рядків WS_URL із нього до кіоска не доходив би. Токен — файлом поза
    # релізом (релізи публічні): нема файла — кіоск живе без каналу подій.
    [ -n "${WS_URL:-}" ] && export WS_URL
    _key="${WS_TOKEN_FILE:-$EXTROVERT_ROOT/config/point.key}"
    [ -f "$_key" ] && export WS_TOKEN_FILE="$_key"
}

pid_of() {
    for _e in $PIDS; do case "$_e" in "$1:"*) echo "${_e#*:}"; return 0;; esac; done
    return 1
}
forget() {
    _new=""
    for _e in $PIDS; do case "$_e" in "$1:"*) ;; *) _new="$_new $_e";; esac; done
    PIDS="$_new"
}
want_line() { grep "^$1 " "$WANT" 2>/dev/null | head -n1; }

start_component() { # start_component <імʼя> <exec> <слот> [аргументи...]
    _name=$1; _exec=$2; _slot=$3; shift 3
    _bin="$EXTROVERT_CURRENT/$_exec"
    [ -x "$_bin" ] || { log "$_name: нема виконуваного $_bin — пропускаю"; return 1; }
    component_env "$_name" "$_slot"
    "$_bin" "$@" >> "$EXTROVERT_LOGS/$_name.log" 2>&1 &
    _pid=$!
    PIDS="$PIDS $_name:$_pid"
    slot_set "$_name" "$_slot"
    log "$_name: запущено pid=$_pid слот=$_slot ($_exec)"
    return 0
}

# Ґречна зупинка: SIGTERM, чекаємо STOP_GRACE_S, лише потім SIGKILL.
# Кіоск на SIGTERM закриває GL і звільняє dispmanx-шар; якщо просто
# вбити, VideoCore може лишити шар за мертвим процесом (спорідена пастка
# з bcm_host_init, docs/roadmap.md).
stop_component() { # stop_component <імʼя>
    _pid=$(pid_of "$1") || return 0
    kill -TERM "$_pid" 2>/dev/null || true
    _w=0
    while kill -0 "$_pid" 2>/dev/null; do
        [ "$_w" -ge "${STOP_GRACE_S:-10}" ] && break
        sleep 1; _w=$((_w + 1))
    done
    if kill -0 "$_pid" 2>/dev/null; then
        log "$1: не вийшов за ${STOP_GRACE_S:-10}с — SIGKILL"
        kill -KILL "$_pid" 2>/dev/null || true
    else
        log "$1: зупинено ґречно за ${_w}с"
    fi
    wait "$_pid" 2>/dev/null || true
    forget "$1"
}

stop_all() { for _e in $PIDS; do stop_component "${_e%%:*}"; done; }

restart_plain() { # restart_plain <імʼя>  — гасимо, потім піднімаємо (є вікно без картинки)
    _line=$(want_line "$1") || true
    stop_component "$1"
    [ -n "$_line" ] || return 0
    # shellcheck disable=SC2086
    set -- $_line
    _n=$1; _x=$2; _ov=$3; shift 3
    start_component "$_n" "$_x" "$(slot_of "$_n")" "$@"
}

# Перезапуск без чорного екрана: нова версія на сусідньому шарі, чекаємо
# від неї живої телеметрії, і лише тоді гасимо стару. Якщо нова не ожила
# (найімовірніше — не вистачило GPU-памʼяті на дві 1080p-поверхні), тихо
# відкочуємось на звичайний послідовний перезапуск, щоб оновлення все одно
# доїхало: краще дві секунди чорноти, ніж застрягла стара версія.
restart_overlap() { # restart_overlap <імʼя>
    _line=$(want_line "$1") || { log "$1: нема в .want"; return 1; }
    # shellcheck disable=SC2086
    set -- $_line
    _name=$1; _exec=$2; _ov=$3; shift 3

    _old_pid=$(pid_of "$_name") || _old_pid=""
    _old_slot=$(slot_of "$_name")
    _new_slot=$([ "$_old_slot" = "0" ] && echo 1 || echo 0)
    _new_sock=$(sock_for "$_name" "$_new_slot")
    rm -f "$_new_sock"

    log "$_name: overlap-перезапуск, слот $_old_slot → $_new_slot"
    component_env "$_name" "$_new_slot"
    "$EXTROVERT_CURRENT/$_exec" "$@" >> "$EXTROVERT_LOGS/$_name.log" 2>&1 &
    _new_pid=$!

    _w=0
    while [ "$_w" -lt "${OVERLAP_HEALTH_S:-25}" ]; do
        if ! kill -0 "$_new_pid" 2>/dev/null; then
            log "$_name: нова версія впала на старті — відкочуюсь на послідовний перезапуск"
            wait "$_new_pid" 2>/dev/null || true
            restart_plain "$_name"
            return 0
        fi
        if telemetry_healthy "$_new_sock"; then
            log "$_name: нова версія малює (за ${_w}с) — гашу стару"
            [ -n "$_old_pid" ] && {
                kill -TERM "$_old_pid" 2>/dev/null || true
                _g=0
                while kill -0 "$_old_pid" 2>/dev/null && [ "$_g" -lt "${STOP_GRACE_S:-10}" ]; do
                    sleep 1; _g=$((_g + 1))
                done
                kill -0 "$_old_pid" 2>/dev/null && kill -KILL "$_old_pid" 2>/dev/null
                wait "$_old_pid" 2>/dev/null || true
            }
            forget "$_name"
            PIDS="$PIDS $_name:$_new_pid"
            slot_set "$_name" "$_new_slot"
            return 0
        fi
        sleep 1; _w=$((_w + 1))
    done

    log "$_name: нова версія не ожила за ${OVERLAP_HEALTH_S:-25}с — гашу її, послідовний перезапуск"
    kill -TERM "$_new_pid" 2>/dev/null || true
    sleep 2
    kill -0 "$_new_pid" 2>/dev/null && kill -KILL "$_new_pid" 2>/dev/null
    wait "$_new_pid" 2>/dev/null || true
    restart_plain "$_name"
}

# ── Старт ────────────────────────────────────────────────────────────────
log "старт, корінь $EXTROVERT_ROOT, реліз $(current_release)"
mkdir -p "$EXTROVERT_LOGS" "$EXTROVERT_STATE"
[ -L "$EXTROVERT_CURRENT" ] || die "нема симлінка $EXTROVERT_CURRENT — спершу install.sh"
state_write supervisor.pid "$$"

# Годинник — ДО запуску компонентів: телеметрія починає штампувати проби з
# першої ж секунди, а кіоск іде за HTTPS, який з часом у минулому відмовляє
# (common.sh, розділ «Годинник»).
clock_restore

# components.conf: <імʼя> <exec> <overlap:0|1> <enabled:0|1> [аргументи...]
grep -v '^[[:space:]]*#' "$COMPONENTS_CONF" 2>/dev/null | grep -v '^[[:space:]]*$' \
  | while read -r _n _x _ov _en _args; do
        [ "$_en" = "1" ] || { log "$_n: вимкнено в components.conf"; continue; }
        echo "$_n $_x $_ov $_args"
    done > "$WANT"

while read -r _n _x _ov _args; do
    # shellcheck disable=SC2086
    start_component "$_n" "$_x" "$(slot_of "$_n")" $_args
done < "$WANT"

LAST_RELEASE=$(current_release)
CLOCK_TICK=0

while :; do
    sleep 2
    [ "$STOPPING" = "1" ] && break

    # Мітка часу раз на хвилину: частіше немає сенсу (журнал ext4 однаково
    # скидається раз на пʼять хвилин, commit=300), рідше — більше втратимо
    # при знеструмленні.
    CLOCK_TICK=$((CLOCK_TICK + 1))
    if [ "$CLOCK_TICK" -ge 30 ]; then CLOCK_TICK=0; clock_save; fi

    # 1. Доглядаємо дітей
    for _e in $PIDS; do
        _name=${_e%%:*}; _pid=${_e#*:}
        kill -0 "$_pid" 2>/dev/null && continue
        wait "$_pid" 2>/dev/null; _rc=$?
        log "$_name: впав (код $_rc) — перезапуск через ${RESTART_DELAY_S:-3}с"
        forget "$_name"
        sleep "${RESTART_DELAY_S:-3}"
        restart_plain "$_name"
    done

    # 2. Запити на перезапуск від апдейтера
    for _req in "$EXTROVERT_STATE"/restart.*; do
        [ -f "$_req" ] || continue
        _name=$(basename "$_req" | sed 's/^restart\.//')
        _mode=$(cat "$_req" 2>/dev/null)
        rm -f "$_req"
        log "$_name: запит на перезапуск (${_mode:-plain}) від апдейтера"
        if [ "$_mode" = "overlap" ]; then restart_overlap "$_name"; else restart_plain "$_name"; fi
    done

    # 3. Новий реліз — новий код і в решти компонентів, не лише в кіоска.
    #
    # Досі тут був лише лог «реліз змінився». Кіоск апдейтер підміняє сам
    # (restart.kiosk), а telemetry й інші так і лишались тим процесом, що
    # запустився колись — із кодом старого релізу. 24.09.2026 це коштувало
    # півдня: у релізі вже був код, який вмикає монітор через CEC, у
    # `current` — той самий реліз, а працювала телеметрія з позаминулого, і
    # монітор не прокидався. Видно це було лише по тому, що в пробі бракувало
    # нового поля.
    #
    # Чекаємо, поки апдейтер добіжить (прапорець `updating`): перезапустити
    # його посеред перевірки здоров'я нової версії означало б зламати відкат.
    _now=$(current_release)
    if [ "$_now" != "$LAST_RELEASE" ]; then
        log "реліз змінився: $LAST_RELEASE → $_now"
        LAST_RELEASE=$_now
        PENDING_RESTART=1
    fi
    if [ "${PENDING_RESTART:-0}" = "1" ] && [ ! -f "$EXTROVERT_STATE/updating" ]; then
        PENDING_RESTART=0
        while read -r _n _x _ov _args; do
            # Кіоск має власний шлях підміни через сусідній шар — не чіпаємо.
            [ "$_n" = "kiosk" ] && continue
            log "$_n: новий реліз — перезапускаю з новим кодом"
            restart_plain "$_n"
        done < "$WANT"
    fi
done

stop_all
log "вихід"
