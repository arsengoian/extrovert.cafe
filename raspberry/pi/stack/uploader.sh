#!/bin/sh
# uploader.sh — сегменти камери з флешки в R2 (docs/video.md, «Вивантаження»).
# Компонент стеку поруч із recorder.sh: той пише, цей вантажить, і жоден не
# чекає на іншого.
#
# На кожен готовий сегмент: api дає підписане посилання (ключ точки з
# config/point.key) → curl -T заливає файл прямо в R2 → api перевіряє, що
# об'єкт є й має той самий розмір, і реєструє сегмент → локальна копія
# стирається. Обрив на будь-якому кроці — файл лишається, наступний прохід
# повторить усе з початку: ключ у R2 детермінований, повтор перезаливає той
# самий об'єкт, а не плодить копії.
#
# Ні перекодування, ні обробки: файл їде байт-у-байт, як його записав
# recorder (власник, 06.10.2026: компонент на малині — максимально легкий).
set -u
LOG_TAG=uploader
. "$(dirname "$0")/common.sh"

API="${API_URL:-https://api.extrovert.cafe/api/v1}"
TOKEN_FILE="${WS_TOKEN_FILE:-$EXTROVERT_ROOT/config/point.key}"
DIR="${RECORDER_BUF-/mnt/buf}/video"
CAMERA="${RECORDER_CAMERA:-cam1}"
# Стеля швидкості заливки. Потік камери — ~170 КБ/с; 400 КБ/с дають
# наздогнати чергу після обриву, але не забивають 4G-канал точки: по ньому
# ж ходить платіжний термінал, і забитий аплінк — це його таймаути.
RATE="${UPLOAD_RATE:-400k}"
BATCH="${UPLOAD_BATCH:-20}"            # скільки сегментів за прохід

STOPPING=0
trap 'STOPPING=1' TERM INT
idle() { _s=$1; while [ "$_s" -gt 0 ] && [ "$STOPPING" = 0 ]; do sleep 1; _s=$((_s - 1)); done; }
LAST=""
say() { [ "$1" = "$LAST" ] && return; LAST=$1; log "$1"; }

# Час початку з імені: «…Z.ts» — UTC (recorder з 06.10.2026), без Z —
# місцевий час малини (сегменти, записані раніше).
start_epoch() {
    _n=${1%.*}; _z=""
    case "$_n" in *Z) _z=1; _n=${_n%Z} ;; esac
    _d=$(printf '%s' "$_n" | sed 's/^\(....\)\(..\)\(..\)T\(..\)\(..\)\(..\)$/\1-\2-\3 \4:\5:\6/')
    if [ -n "$_z" ]; then date -u -d "$_d" +%s 2>/dev/null; else date -d "$_d" +%s 2>/dev/null; fi
}

json_field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

api_post() { # api_post <шлях> <json> — тіло відповіді в stdout, код curl — у $?
    curl -fsS --max-time 30 -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
        -d "$2" "$API/points/$POINT$1"
}

upload_one() { # upload_one <файл>
    _f=$1; _name=$(basename "$_f")
    _bytes=$(stat -c %s "$_f") || return 1
    _at=$(start_epoch "$_name")
    [ -n "$_at" ] || { log "$_name: не розібрав час з імені — пропускаю"; return 1; }
    # Тип — за розширенням: з 07.10.2026 recorder пише mkv (відео й звук),
    # раніше — TS. Api підписує посилання саме під цей content-type.
    case "$_name" in *.mkv) _type=video/x-matroska ;; *) _type=video/mp2t ;; esac
    _body="{\"name\":\"$_name\",\"bytes\":$_bytes,\"started_at\":$_at,\"camera\":\"$CAMERA\"}"
    _resp=$(api_post /video/upload "$_body") || return 1
    _url=$(json_field "$_resp" url); _key=$(json_field "$_resp" key)
    [ -n "$_url" ] && [ -n "$_key" ] || { log "$_name: api не дав посилання"; return 1; }
    # -4: заливаємо по IPv4. На 4G-мережі точки IPv6 до Cloudflare R2
    # зламаний (09.10.2026: `curl -6` на R2 — «couldn't connect» або зависає
    # на MTU, а PUT тоді висить до --max-time і рве SSL; `curl -4` тягне
    # 10 МБ за ~11 с). Малі запити до api (api.extrovert.cafe — лише IPv6)
    # по v6 ідуть, тож -4 ставимо саме на заливку в R2.
    nice -n 10 ionice -c 3 curl -4 -fsS --max-time 900 --limit-rate "$RATE" \
        -H "content-type: $_type" -T "$_f" "$_url" -o /dev/null || return 1
    api_post /video/segment "{\"key\":\"$_key\",\"bytes\":$_bytes,\"started_at\":$_at,\"camera\":\"$CAMERA\"}" >/dev/null || return 1
    rm -f "$_f"
}

log "старт, черга $DIR → $API"
FAILS=0
while [ "$STOPPING" = 0 ]; do
    if [ ! -f "$TOKEN_FILE" ]; then say "немає ключа точки $TOKEN_FILE — вантажити нікуди"; idle 300; continue; fi
    TOKEN=$(cat "$TOKEN_FILE")
    # Готові сегменти — ті, які ffmpeg уже не дописує: не мінялись понад
    # дві хвилини. Найстаріші — першими, щоб архів у R2 ріс без дірок.
    _list=$(find "$DIR" -maxdepth 1 \( -name '*.mkv' -o -name '*.ts' \) -mmin +1 2>/dev/null | sort | head -n "$BATCH")
    if [ -z "$_list" ]; then idle 30; continue; fi
    _done=0
    for _f in $_list; do
        [ "$STOPPING" = 0 ] || break
        if upload_one "$_f"; then
            _done=$((_done + 1))
        else
            FAILS=$((FAILS + 1))
            [ "$FAILS" -eq 1 ] && log "$(basename "$_f"): заливка не вдалась — повторю пізніше"
            break
        fi
    done
    if [ "$_done" -gt 0 ]; then
        [ "$FAILS" -gt 0 ] && log "заливка відновилась після $FAILS невдалих спроб"
        FAILS=0
        say "вантажу: залито $_done за прохід"
        continue
    fi
    # Збій — пауза росте від 30 с до 10 хв: api чи інтернет лежить, і
    # стукати щосекунди немає сенсу. Сегменти тим часом чекають на флешці.
    _w=30; _n=1
    while [ "$_n" -lt "$FAILS" ] && [ "$_w" -lt 600 ]; do _w=$((_w * 2)); _n=$((_n + 1)); done
    [ "$_w" -gt 600 ] && _w=600
    idle "$_w"
done
log "зупинено"
