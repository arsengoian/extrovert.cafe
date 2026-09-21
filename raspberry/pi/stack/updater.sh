#!/bin/sh
# updater.sh — процес стеку, який раз на UPDATE_PERIOD_S питає, чи є нова
# версія, і якщо є — привозить, ПЕРЕВІРЯЄ і підміняє.
#
# Порядок навмисно такий, що кожен ризикований крок стоїть ПІСЛЯ дешевої
# перевірки, яку можна зробити, поки стара версія ще працює:
#
#   1. маніфест      — 200 байт, ETag; нічого не змінює
#   2. завантаження  — у .part, поза releases/; нічого не змінює
#   3. sha256        — биту закачку відкидаємо тут, до розпакування
#   4. розпакування  — у .tmp, атомарний mv у releases/<реліз>
#   5. selftest      — НОВИЙ бінарник малює меню в памʼять (без дисплея,
#                      бо екран зараз у старої версії — див. selftest.h)
#   6. плашка        — кіоск показує "оновлення" (state/updating)
#   7. симлінк       — атомарна підміна current
#   8. перезапуск    — overlap: нова версія на сусідньому шарі, стара
#                      гаситься лише після її першого кадру
#   9. health        — не ожило за UPDATE_HEALTH_S → автоматичний відкат
#
# Пункти 5 і 9 перевіряють різне і обидва потрібні: selftest ловить неповний
# архів і биті ассети без дисплея, health — те, що видно лише на живому
# екрані (GL, dispmanx, памʼять GPU). Постмортем 18.08.2026: процес був
# живий, логи чисті, а на екрані білий фон — саме тому health питає
# телеметрію про КАДРИ, а не про те, чи існує процес.

set -u
LOG_TAG=updater
. "$(dirname "$0")/common.sh"

BAD_LIST="$EXTROVERT_STATE/bad-releases"
ETAG_FILE="$EXTROVERT_STATE/manifest.etag"
UPDATING_FLAG="$EXTROVERT_STATE/updating"
# Перевірити просто зараз, не чекаючи кола: `touch state/check-now`.
# Перезапуск апдейтера для цього не годиться — новий процес починає саме
# з очікування, тож перевірка відсунулась би ще на UPDATE_PERIOD_S.
CHECK_NOW="$EXTROVERT_STATE/check-now"
STOPPING=0

on_term() { STOPPING=1; log "сигнал зупинки"; rm -f "$UPDATING_FLAG"; exit 0; }
trap on_term TERM INT

is_bad() { [ -f "$BAD_LIST" ] && grep -qx "$1" "$BAD_LIST"; }
mark_bad() {
    mkdir -p "$EXTROVERT_STATE"
    printf '%s\n' "$1" >> "$BAD_LIST"
    rm -f "$EXTROVERT_STATE/fetch-failures.$1"
    log "реліз $1 позначено як непридатний — більше не пробуємо"
}

# Обрив завантаження — не вирок релізу: канал на точці мобільний. Але й
# качати вічно не можна — 20 МБ раз на 15 хв з'їдять тариф за тиждень,
# якщо архів у R2 просто не залили. Тому кілька кіл, потім чорний список.
FETCH_ATTEMPTS="${FETCH_ATTEMPTS:-3}"
note_fetch_failure() { # note_fetch_failure <реліз>
    _f="$EXTROVERT_STATE/fetch-failures.$1"
    _n=$(( $(cat "$_f" 2>/dev/null || echo 0) + 1 ))
    if [ "$_n" -ge "$FETCH_ATTEMPTS" ]; then
        log "архів $1 не завантажився $_n кіл поспіль"
        mark_bad "$1"
        return
    fi
    printf '%s\n' "$_n" > "$_f"
    # Без цього наступне коло отримало б на маніфест 304 і не спробувало
    # б знову: ETag уже збережено, а маніфест у R2 не змінився.
    rm -f "$ETAG_FILE"
    log "архів $1 не завантажився (спроба $_n з $FETCH_ATTEMPTS) — повторю наступним колом"
}

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
    else echo ""; fi
}

prune_releases() {
    # Ніколи не видаляємо: поточний, попередній і той, з якого зараз
    # виконується ЦЕЙ скрипт (bash/dash читають файл шматками — знести
    # інод під собою означає випадкове завершення посеред оновлення).
    _cur=$(current_release)
    _prev=$(cat "$EXTROVERT_STATE/previous" 2>/dev/null || echo "")
    _self=$(basename "$(dirname "$(dirname "$0")")")
    _n=0
    ls -1t "$EXTROVERT_RELEASES" 2>/dev/null | while read -r _r; do
        _n=$((_n + 1))
        [ "$_n" -le "$KEEP_RELEASES" ] && continue
        if [ "$_r" = "$_cur" ] || [ "$_r" = "$_prev" ] || [ "$_r" = "$_self" ]; then
            continue
        fi
        log "прибираю старий реліз $_r"
        rm -rf "${EXTROVERT_RELEASES:?}/$_r"
    done
}

# ── Крок 1: маніфест ─────────────────────────────────────────────────────
fetch_manifest() { # → 0 якщо є що читати в $1, 1 якщо нічого нового/помилка
    _out=$1
    _etag=""
    [ -f "$ETAG_FILE" ] && _etag=$(cat "$ETAG_FILE")
    _hdr="$EXTROVERT_STATE/.manifest.hdr"
    if [ -n "$_etag" ]; then
        curl -fsS --max-time 30 --retry 2 -D "$_hdr" -H "If-None-Match: $_etag" \
             -o "$_out" "$UPDATE_URL" 2>>"$EXTROVERT_LOGS/updater.log" || return 1
    else
        curl -fsS --max-time 30 --retry 2 -D "$_hdr" \
             -o "$_out" "$UPDATE_URL" 2>>"$EXTROVERT_LOGS/updater.log" || return 1
    fi
    grep -qi '^HTTP/.* 304' "$_hdr" 2>/dev/null && return 1
    _new_etag=$(grep -i '^etag:' "$_hdr" 2>/dev/null | head -n1 | sed 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//; s/[[:space:]]*$//')
    [ -n "$_new_etag" ] && printf '%s\n' "$_new_etag" > "$ETAG_FILE"
    [ -s "$_out" ]
}

# ── Кроки 2-4: привезти й розпакувати ────────────────────────────────────
# Код повернення розрізняє, чия це вина: 1 — архів непридатний (sha, tar,
# не наш реліз), повторювати марно; 2 — архів не доїхав, наступне коло
# може бути вдалішим (note_fetch_failure).
stage_release() { # stage_release <реліз> <url> <sha256> → 0 / 1 / 2
    _rel=$1; _url=$2; _sum=$3
    _part="$EXTROVERT_RELEASES/.$_rel.part"
    _tmp="$EXTROVERT_RELEASES/.$_rel.tmp"
    mkdir -p "$EXTROVERT_RELEASES"
    rm -rf "$_part" "$_tmp"

    log "завантажую $_rel"
    # --retry-delay і -C - навмисно: канал на точці мобільний, обрив
    # посеред 20 МБ — очікувана ситуація, а не виняток.
    curl -fsS --max-time 900 --retry 5 --retry-delay 10 -C - \
         -o "$_part" "$_url" 2>>"$EXTROVERT_LOGS/updater.log" || {
        log "завантаження провалилось"; rm -f "$_part"; return 2; }

    _got=$(sha256_of "$_part")
    if [ -z "$_got" ]; then
        log "нема sha256sum — не можу перевірити архів, відмовляюсь ставити"
        rm -f "$_part"; return 1
    fi
    if [ "$_got" != "$_sum" ]; then
        log "sha256 не збігся: чекали $_sum, отримали $_got"
        rm -f "$_part"; return 1
    fi

    mkdir -p "$_tmp"
    tar -xzf "$_part" -C "$_tmp" || { log "архів не розпакувався"; rm -rf "$_part" "$_tmp"; return 1; }
    rm -f "$_part"
    [ -f "$_tmp/stack/components.conf" ] || {
        log "в архіві нема stack/components.conf — це не наш реліз"; rm -rf "$_tmp"; return 1; }
    # Біт виконання не завжди переживає дорогу: реліз пакується на ПК, а на
    # NTFS його немає взагалі. Без цього selftest відмовиться від цілком
    # нормального релізу ("нема bin/pos-native-pi") і занесе його в bad.
    chmod +x "$_tmp/bin/pos-native-pi" "$_tmp/stack/"*.sh 2>/dev/null || true
    rm -rf "${EXTROVERT_RELEASES:?}/$_rel"
    mv "$_tmp" "$EXTROVERT_RELEASES/$_rel" || { log "не змогли покласти реліз на місце"; return 1; }
    log "реліз $_rel розпаковано"
    return 0
}

# ── Крок 5: перевірка нової версії без дисплея ───────────────────────────
selftest_release() { # selftest_release <реліз> → 0/1
    _dir="$EXTROVERT_RELEASES/$1"
    _bin="$_dir/bin/pos-native-pi"
    [ -x "$_bin" ] || { log "selftest: нема $_bin"; return 1; }
    log "selftest нової версії…"
    EXTROVERT_STATE="$EXTROVERT_STATE" \
    ASSETS="$_dir/assets" \
    SELFTEST_PNG="$EXTROVERT_STATE/selftest-$1.png" \
      "$_bin" --selftest >> "$EXTROVERT_LOGS/updater.log" 2>&1
}

# ── Кроки 6-9: підміна з відкатом ────────────────────────────────────────
switch_to() { # switch_to <реліз> → 0/1
    _rel=$1
    _prev=$(current_release)

    printf 'Оновлення %s\n' "$_rel" > "$UPDATING_FLAG"
    log "плашка «оновлення» піднята, чекаю ${UPDATE_BANNER_LEAD_S:-6}с"
    sleep "${UPDATE_BANNER_LEAD_S:-6}"

    [ -n "$_prev" ] && state_write previous "$_prev"
    ln -sfn "$EXTROVERT_RELEASES/$_rel" "$EXTROVERT_CURRENT.new" \
        && mv -Tf "$EXTROVERT_CURRENT.new" "$EXTROVERT_CURRENT" \
        || { log "не вдалось перемкнути симлінк"; rm -f "$UPDATING_FLAG"; return 1; }
    log "current → $_rel"

    # Просимо супервізора перезапустити кіоск через сусідній шар.
    state_write restart.kiosk "overlap"

    _w=0
    while [ "$_w" -lt "${UPDATE_HEALTH_S:-90}" ]; do
        sleep 3; _w=$((_w + 3))
        _slot=$(cat "$EXTROVERT_STATE/slot.kiosk" 2>/dev/null || echo 0)
        if telemetry_healthy "/tmp/pos-native-$_slot.sock"; then
            log "нова версія жива (кадри йдуть) за ${_w}с"
            rm -f "$UPDATING_FLAG"
            state_write version "$_rel"
            state_write last_update_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            return 0
        fi
    done

    log "нова версія не ожила за ${UPDATE_HEALTH_S:-90}с — ВІДКОТ на $_prev"
    mark_bad "$_rel"
    if [ -n "$_prev" ] && [ -d "$EXTROVERT_RELEASES/$_prev" ]; then
        ln -sfn "$EXTROVERT_RELEASES/$_prev" "$EXTROVERT_CURRENT.new"
        mv -Tf "$EXTROVERT_CURRENT.new" "$EXTROVERT_CURRENT"
        state_write restart.kiosk "plain"
        state_write version "$_prev"
        log "відкотились на $_prev"
    else
        log "відкочуватись нема на що — лишаю як є, супервізор перезапускатиме"
    fi
    rm -f "$UPDATING_FLAG"
    return 1
}

# ── Головний цикл ────────────────────────────────────────────────────────
log "старт, джерело $UPDATE_URL, період ${UPDATE_PERIOD_S}с"
mkdir -p "$EXTROVERT_STATE" "$EXTROVERT_LOGS" "$EXTROVERT_RELEASES"
[ -f "$EXTROVERT_STATE/version" ] || state_write version "$(current_release)"

while :; do
    # Джитер, щоб десяток точок не бив у R2 одночасно після спільного
    # блекауту. $$ як джерело — детерміновано в межах процесу й достатньо
    # різне між пристроями.
    _jitter=$(( $$ % 60 ))
    _slept=0
    while [ "$_slept" -lt $((UPDATE_PERIOD_S + _jitter)) ]; do
        sleep 5; _slept=$((_slept + 5))
        [ "$STOPPING" = "1" ] && exit 0
        if [ -f "$CHECK_NOW" ]; then
            rm -f "$CHECK_NOW"
            log "перевірка на вимогу (state/check-now)"
            break
        fi
    done

    _man="$EXTROVERT_STATE/.manifest.json"
    fetch_manifest "$_man" || { log "маніфест: нічого нового або мережа мовчить"; continue; }

    _rel=$(json_get "$_man" release)
    _url=$(json_get "$_man" url)
    _sum=$(json_get "$_man" sha256)
    [ -n "$_rel" ] && [ -n "$_url" ] && [ -n "$_sum" ] || { log "маніфест неповний — ігнорую"; continue; }

    _cur=$(current_release)
    [ "$_rel" = "$_cur" ] && { log "вже на $_rel"; continue; }
    is_bad "$_rel" && { log "$_rel у чорному списку — пропускаю"; continue; }

    log "є нова версія: $_cur → $_rel"
    prune_releases

    if [ ! -d "$EXTROVERT_RELEASES/$_rel" ]; then
        stage_release "$_rel" "$_url" "$_sum"
        case $? in
            0) rm -f "$EXTROVERT_STATE/fetch-failures.$_rel" ;;
            2) note_fetch_failure "$_rel"; continue ;;
            *) mark_bad "$_rel"; continue ;;
        esac
    else
        log "реліз $_rel уже лежить локально — пропускаю завантаження"
    fi

    selftest_release "$_rel" || {
        log "selftest провалено — стара версія лишається працювати"
        mark_bad "$_rel"
        continue
    }

    if switch_to "$_rel"; then
        log "оновлення до $_rel завершено"
        # Передаємо керування новій версії себе самого: далі цикл має
        # крутити вже оновлений updater.sh. exec, а не рестарт супервізором:
        # апдейтер не має себе перезапускати чужими руками, і так зберігається
        # той самий pid для systemd/логів.
        log "перезапускаю апдейтер із нового релізу"
        exec "$EXTROVERT_CURRENT/stack/updater.sh"
    fi
done
