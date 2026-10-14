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
# Верхня межа темпу заливки. Потік камери з 09.10.2026 — 720p, ~0,75 Мбіт/с,
# тобто ~95 КБ/с (сегмент ~5,7 МБ на хвилину; до того 1080p — ~170 КБ/с).
# 800 КБ/с ≈ 6,4 Мбіт/с — це ~8 потоків: живий запис іде, а година
# накопиченого (~340 МБ) доганяється приблизно за 8 хвилин. До 12.10.2026
# межа була 400: вище боялись забити 4G-канал, по якому ходить платіжний
# термінал. Тепер темп сам відступає на заторі (pace нижче), і межа лише
# каже, як швидко доганяти чергу, коли канал вільний; обсяг трафіку від неї
# не змінюється (власник, 12.10.2026).
RATE="${UPLOAD_RATE:-800k}"
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
# телеметрія, тунель і термінал стоять у черзі за відео.
#
# Тому файл у curl подає pace() — по шматку на секунду, і темп
# підлаштовується щодві секунди прямо під час файла, а не між файлами
# (власник: на 8 КБ/с один сегмент іде 12 хвилин, і стеля між файлами
# піднімалась би годинами). Два сигнали:
#   - пінг до api: коли заливка забиває чергу в роутері, затримка росте
#     раніше, ніж щось ламається. Вище базової на 150 мс або пінг загубився
#     — темп ×0,6;
#   - curl не встигає забрати шматок за секунду (запис у трубу блокується)
#     — канал вужчий за темп: теж ×0,6;
#   - тихо — ×1,25: від 8 до 800 КБ/с за ~40 с.
# Межі — UPLOAD_MIN_KB…UPLOAD_RATE. Нижче 8 КБ/с сегмент хвилинного запису
# не встигає піти й за десять хвилин. Темп живе в state/: наступний файл і
# заливка після ребуту стартують із нього, а не з повних 800 у канал, який
# щойно ледве дихав.
CAP_FILE="$EXTROVERT_STATE/upload.cap"
PING_HOST="${UPLOAD_PING_HOST:-${TELEMETRY_PING_HOST:-api.extrovert.cafe}}"
cap_kb() {
    _c=$(cat "$CAP_FILE" 2>/dev/null)
    case "$_c" in ''|*[!0-9]*) _c=$MAX_KB ;; esac
    [ "$_c" -gt "$MAX_KB" ] && _c=$MAX_KB
    [ "$_c" -lt "$MIN_KB" ] && _c=$MIN_KB
    echo "$_c"
}
rtt_ms() { ping -c 1 -W 2 "$PING_HOST" 2>/dev/null | sed -n 's/.*time=\([0-9]*\).*/\1/p' | head -n 1; }
# Мілісекунди в $NOW без жодного процесу: read — вбудована команда, а Pi 1
# на кожному fork (date, awk) платить процесором, якого в кіоска й так мало.
# /proc/uptime має рівно дві цифри після крапки; нуль попереду знімаємо,
# бо «08» арифметика sh читає як вісімкове й падає.
now() {
    read -r _u _rest < /proc/uptime
    _fr=${_u#*.}; _fr=${_fr#0}
    NOW=$(( ${_u%.*} * 1000 + ${_fr:-0} * 10 ))
}
cap_save() {
    [ "$_rate" -gt "$MAX_KB" ] && _rate=$MAX_KB
    [ "$_rate" -lt "$MIN_KB" ] && _rate=$MIN_KB
    printf '%s\n' "$_rate" > "$CAP_FILE.tmp" && mv "$CAP_FILE.tmp" "$CAP_FILE"
}

pace() { # pace <файл> — віддає файл у stdout у темпі, який сам і підбирає
    _f=$1; _size=$(stat -c %s "$_f") || return 1
    _total=$(( (_size + 1023) / 1024 ))
    _rate=$(cap_kb); _off=0; _base=""
    # Базова затримка — поки канал ще вільний від нас. Пінг не відповідає
    # зовсім (ICMP різають) — живемо лише на сигналі труби.
    for _i in 1 2 3; do
        _r=$(rtt_ms)
        [ -n "$_r" ] && { [ -z "$_base" ] || [ "$_r" -lt "$_base" ]; } && _base=$_r
    done
    now; _pinged=$NOW
    while [ "$_off" -lt "$_total" ]; do
        now; _t0=$NOW; _sent=0; _choked=0
        # Порція секунди — дрібними шматками (восьма частина темпу, не менше
        # 8 КБ), і після кожного дивимось на годинник. Одним шматком на всю
        # секунду (12.10.2026, перша версія) на каналі 10 КБ/с при темпі
        # 400 запис висів 40 с, і рішення «гальмуй» приходило аж тоді.
        _piece=$((_rate / 8)); [ "$_piece" -lt 8 ] && _piece=8
        while [ "$_sent" -lt "$_rate" ] && [ "$_off" -lt "$_total" ]; do
            _n=$((_rate - _sent)); [ "$_n" -gt "$_piece" ] && _n=$_piece
            dd if="$_f" bs=1024 skip="$_off" count="$_n" status=none 2>/dev/null || return 1
            _off=$((_off + _n)); _sent=$((_sent + _n))
            now
            if [ $((NOW - _t0)) -gt 1500 ]; then
                # curl не встигає: канал вужчий за темп. Новий темп — 0,6 від
                # того, що реально пройшло за цю «секунду».
                _rate=$((_sent * 1000 / (NOW - _t0) * 6 / 10)); _choked=1; cap_save
                break
            fi
        done
        if [ "$_choked" = 0 ] && [ $((NOW - _pinged)) -ge 2000 ]; then
            _pinged=$NOW
            _r=""; [ -n "$_base" ] && _r=$(rtt_ms)
            if [ -n "$_base" ] && { [ -z "$_r" ] || [ "$_r" -gt $((_base + 150)) ]; }; then
                _rate=$((_rate * 6 / 10))
            elif [ -z "$_base" ] || [ "$_r" -lt $((_base + 60)) ]; then
                _rate=$((_rate * 5 / 4 + 1))
            fi
            [ -n "$_r" ] && [ "$_r" -lt "$_base" ] && _base=$_r
            cap_save
        fi
        now; _left=$((1000 - NOW + _t0))
        if [ "$_left" -gt 0 ]; then _l=$((1000 + _left)); sleep "0.${_l#1}"; fi
    done
    return 0
}

STOPPING=0
trap 'STOPPING=1' TERM INT
# Чекання — посекундно, щоб SIGTERM не чекав хвилинами.
idle() {
    _s=$1
    while [ "$_s" -gt 0 ] && [ "$STOPPING" = 0 ]; do
        sleep 1; _s=$((_s - 1))
    done
}
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
upload_mark() { # upload_mark <файл> <код curl> <темп на старті КБ/с> <байтів> <секунд>
    _b=${4:-0}; _b=${_b%%.*}; _s=$(printf '%s' "${5:-0}" | tr ',' '.')
    _kb=$(awk -v b="$_b" -v s="$_s" 'BEGIN { if (s > 0) printf "%.1f", b / 1024 / s; else printf "0" }')
    _ok=0; [ "$2" = 0 ] && _ok=1
    _end=$(cap_kb)  # темп, на якому pace() закінчив файл
    # Замір — лише коли канал справді щось віз: вдалась, або обірвалась за
    # таймаутом чи «нижче 2 КБ/с» (curl 28) з байтами в дорозі. Відмова DNS
    # чи зʼєднання (6, 7…) про ширину каналу нічого не каже.
    if [ "$_ok" = 1 ] || { [ "$2" = 28 ] && [ "$_b" -gt 0 ]; }; then
        printf '%s %s %s %s %s\n' "$(date +%s)" "$_ok" "$_b" "$_s" "$_end" > "$MARK.tmp" && mv "$MARK.tmp" "$MARK"
    fi
    if [ "$_ok" = 1 ]; then
        log "$1: $((_b / 1024)) КБ за ${_s%.*} с — у середньому $_kb КБ/с (темп $3 → $_end)"
    else
        log "$1: обрив (curl $2) після $((_b / 1024)) КБ за ${_s%.*} с — $_kb КБ/с (темп $3 → $_end)"
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
    # заливка душила тунель, коли аплінк просів).
    #
    # Темп задає pace() (див. угорі), тож curl читає файл зі stdin. Довжину
    # кажемо самі, а chunked прибираємо порожнім Transfer-Encoding: R2 не
    # приймає заливку без Content-Length, а curl 7.52 зі Stretch з `-T -`
    # інакше шле chunked навіть поруч із Content-Length (перевірено
    # 12.10.2026 на тому самому curl). --max-time — на найгірший випадок,
    # увесь файл на нижній межі, із запасом у півтора раза: фіксовані 300 с
    # на 8 КБ/с обривали б сегмент на 2,4 МБ із 5,7, і він не пішов би
    # ніколи. Підписане посилання живе годину — вистачає й на це.
    _start=$(cap_kb)
    _mt=$(( _bytes / (MIN_KB * 1024) * 3 / 2 + 60 )); [ "$_mt" -lt 300 ] && _mt=300
    _stat=$(pace "$_f" | nice -n 10 ionice -c 3 curl -4 -fsS --max-time "$_mt" --speed-limit 2000 --speed-time 30 \
        -w '%{size_upload} %{time_total}' -H "content-type: $_type" -H "Content-Length: $_bytes" -H "Transfer-Encoding:" \
        -T - "$_url" -o /dev/null)
    _rc=$?
    # shellcheck disable=SC2086 # -w дає рівно два числа — два аргументи
    upload_mark "$_name" "$_rc" "$_start" $_stat
    [ "$_rc" -eq 0 ] || return 1
    api_post /video/segment "{\"key\":\"$_key\",\"bytes\":$_bytes,\"started_at\":$_at,\"camera\":\"$CAMERA\"}" >/dev/null || return 1
    rm -f "$_f"
}

mkdir -p "$EXTROVERT_STATE"
log "старт, черга $DIR → $API, темп $(cap_kb) КБ/с (межі $MIN_KB…$MAX_KB, пінг до $PING_HOST)"
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
