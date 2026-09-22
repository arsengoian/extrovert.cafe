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
UPDATE_PERIOD_S="${UPDATE_PERIOD_S:-900}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"

log() {
    # Один формат на всі процеси стеку: дата, хто, що. Пишемо в stdout —
    # перенаправленням керує той, хто запустив (supervisor або systemd).
    printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${LOG_TAG:-stack}" "$*"
}

die() { log "ФАТАЛЬНО: $*"; exit 1; }

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
# Читає JSON із UNIX-сокета кіоска (telemetry.c). nc -U є в Stretch;
# python3 лишається запасним шляхом, бо на іншому образі nc може бути
# traditional-збіркою без -U.
telemetry_read() { # telemetry_read <шлях-сокета>
    [ -S "$1" ] || return 1
    if command -v nc >/dev/null 2>&1 && nc -U "$1" 2>/dev/null | head -n1 | grep -q fps; then
        nc -U "$1" 2>/dev/null | head -n1
        return 0
    fi
    command -v python3 >/dev/null 2>&1 || return 1
    python3 -c "
import socket,sys
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.settimeout(3)
try:
    s.connect(sys.argv[1]); sys.stdout.write(s.recv(4096).decode())
except Exception:
    sys.exit(1)
" "$1" 2>/dev/null
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
