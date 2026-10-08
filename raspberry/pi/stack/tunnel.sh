#!/bin/sh
# tunnel.sh — зворотний ssh-тунель малини до дроплета (raspberry-pi.md,
# «Тунель»). Компонент стеку, як recorder і uploader.
#
# Навіщо: точка за мобільним NAT, і зайти на неї можна було лише з Wi-Fi
# кав'ярні. 06.10.2026 після блекауту малина лишилась без зв'язку, і
# подивитись, що з нею, з іншого місця було нічим. Тепер вона сама тримає
# вихідне з'єднання до дроплета й відкриває на його 127.0.0.1 свій порт;
# людина заходить через дроплет:
#   ssh -J root@<дроплет>:2222 -p <порт> pi@127.0.0.1   (scripts/pi-ssh.sh)
# Роутер кав'ярні не чіпаємо: з'єднання вихідне, як телеметрія.
#
# Ключ тунелю малина генерує сама (config/tunnel_ed25519, на розділі data) і
# реєструє публічну частину в api під ключем точки; cron на дроплеті кладе
# її в authorized_keys користувача pitunnel з обмеженням лише на свій порт
# (raspberry/pitunnel). Нового ключа на точку возити не треба.
set -u
LOG_TAG=tunnel
. "$(dirname "$0")/common.sh"

API="${API_URL:-https://api.extrovert.cafe/api/v1}"
TOKEN_FILE="${WS_TOKEN_FILE:-$EXTROVERT_ROOT/config/point.key}"
KEY="$EXTROVERT_ROOT/config/tunnel_ed25519"
KNOWN="$(dirname "$0")/tunnel_known_hosts"

STOPPING=0
SSH=""
trap 'STOPPING=1; [ -n "$SSH" ] && kill "$SSH" 2>/dev/null' TERM INT
idle() { _s=$1; while [ "$_s" -gt 0 ] && [ "$STOPPING" = 0 ]; do sleep 1; _s=$((_s - 1)); done; }
LAST=""
say() { [ "$1" = "$LAST" ] && return; LAST=$1; log "$1"; }
json_str() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
json_num() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p"; }

log "старт"
FAILS=0
while [ "$STOPPING" = 0 ]; do
    if [ ! -f "$TOKEN_FILE" ]; then say "немає ключа точки — тунель не реєструю"; idle 300; continue; fi
    if [ ! -f "$KEY" ]; then
        ssh-keygen -q -t ed25519 -N "" -C "point:$POINT" -f "$KEY" || { say "не вдалось створити ключ тунелю"; idle 300; continue; }
        log "створено ключ тунелю $KEY"
    fi
    # Реєстрація щоразу перед підключенням: ідемпотентна, а заразом дає
    # актуальні адресу й порт (дроплет могли перестворити).
    _resp=$(curl -fsS --max-time 30 -H "authorization: Bearer $(cat "$TOKEN_FILE")" -H "content-type: application/json" \
        -d "{\"pubkey\":\"$(cat "$KEY.pub")\"}" "$API/points/$POINT/tunnel" 2>&1)
    _host=$(json_str "$_resp" host); _user=$(json_str "$_resp" user)
    _port=$(json_num "$_resp" port); _listen=$(json_num "$_resp" listen)
    if [ -z "$_host" ] || [ -z "$_user" ] || [ -z "$_port" ] || [ -z "$_listen" ]; then
        say "api не дав адресу тунелю: $(printf '%s' "$_resp" | head -c 200)"
        FAILS=$((FAILS + 1))
    else
        say "тримаю тунель: $_user@$_host:$_port, порт $_listen на дроплеті"
        _t0=$(date +%s)
        # ServerAlive — помітити мертве з'єднання за ~90 с (4G рве їх мовчки);
        # ExitOnForwardFailure — якщо старий порт на дроплеті ще зайнятий
        # напівмертвою сесією, вийти й повторити, а не висіти без тунелю.
        ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes \
            -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
            -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN" \
            -i "$KEY" -p "$_port" -R "127.0.0.1:$_listen:127.0.0.1:22" \
            "$_user@$_host" 2> /tmp/tunnel-ssh.log &
        SSH=$!
        wait "$SSH"; _rc=$?
        SSH=""
        [ "$STOPPING" = 1 ] && break
        if [ $(( $(date +%s) - _t0 )) -gt 300 ]; then FAILS=0; else FAILS=$((FAILS + 1)); fi
        [ "$FAILS" -le 1 ] && log "тунель обірвався (код $_rc): $(tail -n 2 /tmp/tunnel-ssh.log 2>/dev/null | tr '\n' ' ')"
        LAST=""
    fi
    # Одразу після реєстрації нового ключа дроплет його ще не знає (cron раз
    # на хвилину) — перші спроби впадуть, і це нормально. Пауза росте від
    # 10 с до 5 хв.
    _w=10; _n=1
    while [ "$_n" -lt "$FAILS" ] && [ "$_w" -lt 300 ]; do _w=$((_w * 2)); _n=$((_n + 1)); done
    [ "$_w" -gt 300 ] && _w=300
    idle "$_w"
done
log "зупинено"
