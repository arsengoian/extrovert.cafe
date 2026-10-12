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
# Верхня стеля швидкості заливки. Потік камери — ~170 КБ/с; 400 КБ/с дають
# наздогнати чергу після обриву, але не забивають 4G-канал точки: по ньому
# ж ходить платіжний термінал, і забитий аплінк — це його таймаути.
RATE="${UPLOAD_RATE:-400k}"
BATCH="${UPLOAD_BATCH:-20}"            # скільки сегментів за прохід
# Останній замір каналу — для телеметрії (telemetry.sh, upload_metrics).
# На розділі data, а не у /tmp: переживає ребут, тож і після блекауту видно,
# яким канал був востаннє.
MARK="$EXTROVERT_STATE/upload.last"

# КБ/с з запису curl --limit-rate: «400k» → 400, «1m» → 1024, «50000» → 48.
rate_kb() {
    case "$1" in
        *[kK]) echo "${1%?}" ;;
        *[mM]) echo $(( ${1%?} * 1024 )) ;;
        *) echo $(( ${1:-0} / 1024 )) ;;
    esac
}
MAX_KB=$(rate_kb "$RATE")
MIN_KB="${UPLOAD_MIN_KB:-8}"

# ── Відео — найнижчий пріоритет у каналі (власник, 09.10 і 12.10.2026) ───
# nice й ionice знижують пріоритет лише на процесорі й диску, а мережа їх не
# бачить: на 4G, що тягне 10 КБ/с, фіксовані 400 КБ/с — це весь канал, і
# телеметрія, тунель і термінал стоять у черзі за відео. Тому стеля
# адаптивна, за заміром кожної заливки:
#   - уперлись у власну стелю (≥ 90 %) — канал, мабуть, тягне більше:
#     стелю ×1,5, але не вище UPLOAD_RATE;
#   - не дотягли — вузьке місце сам канал, і він дав S: наступна стеля
#     0,6·S, тобто ~40 % каналу лишається решті;
#   - не нижче UPLOAD_MIN_KB (8 КБ/с): ще нижче сегмент хвилинного запису
#     не встигає піти й за десять хвилин, а заливати так — лише займати канал.
# Стеля живе в state/: після ребуту заливка стартує з тієї, на якій
# зупинилась, а не з повних 400 у канал, який щойно ледве дихав.
CAP_FILE="$EXTROVERT_STATE/upload.cap"
cap_kb() {
    _c=$(cat "$CAP_FILE" 2>/dev/null)
    case "$_c" in ''|*[!0-9]*) _c=$MAX_KB ;; esac
    [ "$_c" -gt "$MAX_KB" ] && _c=$MAX_KB
    [ "$_c" -lt "$MIN_KB" ] && _c=$MIN_KB
    echo "$_c"
}
cap_adjust() { # cap_adjust <1|0 вдалась> <КБ/с> <стеля, з якою йшли>
    _n=$(awk -v ok="$1" -v s="$2" -v c="$3" -v max="$MAX_KB" -v min="$MIN_KB" 'BEGIN {
        n = (ok == 1 && s >= 0.9 * c) ? c * 1.5 : s * 0.6
        if (n > max) n = max; if (n < min) n = min; printf "%d", n }')
    printf '%s\n' "$_n" > "$CAP_FILE.tmp" && mv "$CAP_FILE.tmp" "$CAP_FILE"
}

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

# Замір кожної спроби заливки (ідея власника, 12.10.2026): скільки байтів
# пішло й за скільки секунд — у лог і в $MARK, звідки його щохвилини бере
# телеметрія. Невдала спроба теж замір: обрив на «нижче 2 КБ/с» каже, що
# канал ледве живий, а байти, що встигли піти, — наскільки.
upload_mark() { # upload_mark <файл> <код curl> <стеля КБ/с> <байтів> <секунд>
    _b=${4:-0}; _b=${_b%%.*}; _s=$(printf '%s' "${5:-0}" | tr ',' '.')
    _kb=$(awk -v b="$_b" -v s="$_s" 'BEGIN { if (s > 0) printf "%.1f", b / 1024 / s; else printf "0" }')
    _ok=0; [ "$2" = 0 ] && _ok=1
    # Замір — лише коли канал справді щось віз: вдалась, або обірвалась за
    # таймаутом чи «нижче 2 КБ/с» (curl 28) з байтами в дорозі. Відмова DNS
    # чи зʼєднання (6, 7…) про ширину каналу нічого не каже — стелю не чіпаємо.
    if [ "$_ok" = 1 ] || { [ "$2" = 28 ] && [ "$_b" -gt 0 ]; }; then
        printf '%s %s %s %s %s\n' "$(date +%s)" "$_ok" "$_b" "$_s" "$3" > "$MARK.tmp" && mv "$MARK.tmp" "$MARK"
        cap_adjust "$_ok" "$_kb" "$3"
    fi
    if [ "$_ok" = 1 ]; then
        log "$1: $((_b / 1024)) КБ за ${_s%.*} с — $_kb КБ/с (стеля $3, далі $(cap_kb))"
    else
        log "$1: обрив (curl $2) після $((_b / 1024)) КБ за ${_s%.*} с — $_kb КБ/с (стеля $3, далі $(cap_kb))"
    fi
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
    #
    # --speed-limit/--speed-time: якщо віддача падає нижче 2 КБ/с на 30 с —
    # обрив, а не висіння до --max-time. Відео — найнижчий пріоритет: на
    # кволому 4G воно не має тримати аплінк, по якому ходять платіжний
    # термінал і зворотний тунель. Так стала заливка звільняє канал за
    # півхвилини, а не тримає його хвилинами намарно (власник, 09.10.2026:
    # заливка душила тунель, коли аплінк просів). Стелю швидкості задає
    # cap_kb (див. угорі), а --max-time росте разом із нею: удвічі довше,
    # ніж файл іде на стелі, але не менше 300 с. Фіксовані 300 с на стелі
    # 8 КБ/с обривали б кожен сегмент на 2,4 МБ із 5,7, і він не пішов би
    # ніколи. Підписане посилання живе годину — з запасом і на 8 КБ/с.
    _cap=$(cap_kb)
    _mt=$(( _bytes / (_cap * 1024) * 2 + 60 )); [ "$_mt" -lt 300 ] && _mt=300
    _stat=$(nice -n 10 ionice -c 3 curl -4 -fsS --max-time "$_mt" --speed-limit 2000 --speed-time 30 --limit-rate "${_cap}k" \
        -w '%{size_upload} %{time_total}' -H "content-type: $_type" -T "$_f" "$_url" -o /dev/null)
    _rc=$?
    # shellcheck disable=SC2086 # -w дає рівно два числа — два аргументи
    upload_mark "$_name" "$_rc" "$_cap" $_stat
    [ "$_rc" -eq 0 ] || return 1
    api_post /video/segment "{\"key\":\"$_key\",\"bytes\":$_bytes,\"started_at\":$_at,\"camera\":\"$CAMERA\"}" >/dev/null || return 1
    rm -f "$_f"
}

mkdir -p "$EXTROVERT_STATE"
log "старт, черга $DIR → $API, стеля $(cap_kb) КБ/с (межі $MIN_KB…$MAX_KB)"
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
