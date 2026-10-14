#!/bin/sh
# wifi.sh — друга дорога в інтернет: Wi-Fi клубу через USB-адаптер
# (raspberry-pi.md, «Wi-Fi клубу»). Компонент стеку, як tunnel і uploader.
#
# Навіщо (14.10.2026): аплінк роутера LTE у клубі буває мертвий годинами —
# заливка рвалась, тунель падав, а з телефона в його мережі не відкривався
# навіть спідтест. Wi-Fi клубу тим часом працював. Тепер малина тримає обидві
# дороги: Wi-Fi — перша (менша метрика маршруту), LTE через eth0 — запасна,
# і на неї компонент перемикає, коли Wi-Fi є, а інтернету за ним нема.
# Камера (Tapo C100 у Wi-Fi роутера LTE) лишається досяжною через eth0: до її
# підмережі є свій маршрут, і від default він не залежить.
#
# Корінь під overlay (§5): /etc живе в RAM і після кожного ребуту заводський.
# Тому мережу й пароль тримаємо в config/wifi.conf на розділі даних (його
# пише scripts/pi-wifi.sh — лише PSK-хеш, без відкритого пароля), а цей
# компонент щоразу заново кладе їх у /etc і будить wpa_supplicant. Сам
# wpa_supplicant на wlan0 запускає dhcpcd (хук 10-wpa_supplicant), щойно
# адаптер з'являється, — ми лише даємо йому конфіг.
set -u
LOG_TAG=wifi
. "$(dirname "$0")/common.sh"

CONF="$EXTROVERT_ROOT/config/wifi.conf"
WPA=/etc/wpa_supplicant/wpa_supplicant.conf
IFACE="${WIFI_IFACE:-wlan0}"
# br0 (LTE) dhcpcd ставить із метрикою 203, а бездротовим за замовчуванням
# дає 300+ — тобто Wi-Fi був би запасним. Менше число — перша дорога.
METRIC="${WIFI_METRIC:-100}"

STOPPING=0
trap 'STOPPING=1' TERM INT
idle() { _s=$1; while [ "$_s" -gt 0 ] && [ "$STOPPING" = 0 ]; do sleep 1; _s=$((_s - 1)); done; }
LAST=""
say() { [ "$1" = "$LAST" ] && return; LAST=$1; log "$1"; }

# Конфіг, з яким dhcpcd справді запущений. Зазвичай /etc/dhcpcd.conf, але
# поки на картці стояв міст (до патча 14.10.2026), dhcpcd читав
# /run/dhcpcd.conf через -f (raspberry-pi.md, «Міст br0»). Не зашиваємо:
# картку з мостом могли б і повернути (-Rollback, старий образ).
dhcpcd_conf() {
    _pid=$(pgrep -o -x dhcpcd) || { echo /etc/dhcpcd.conf; return; }
    _f=$(tr '\0' '\n' < "/proc/$_pid/cmdline" 2>/dev/null | sed -n '/^-f$/{n;p;}')
    echo "${_f:-/etc/dhcpcd.conf}"
}

apply() {
    _dc=$(dhcpcd_conf)
    if ! grep -q "^interface $IFACE\$" "$_dc"; then
        printf '\ninterface %s\nmetric %s\n' "$IFACE" "$METRIC" | sudo -n tee -a "$_dc" >/dev/null || return 1
        # Метрику dhcpcd бере лише на старті, тож перезапуск — раз на ребут,
        # коли рядок щойно дописаний. `dhcpcd -n` не годиться (14.10.2026):
        # головний процес тоді перечитує /etc/dhcpcd.conf навіть із -f, де
        # немає `denyinterfaces eth0`, і роздає адресу порту мосту (eth0
        # отримав 169.254.x поруч із br0). Юніт же стартує з правильним -f,
        # а адреси br0 на час перезапуску лишаються (`persistent` у конфігу).
        sudo -n systemctl restart dhcpcd || return 1
    fi
    # reconfigure рве з'єднання з точкою на ~30 с, тож лише коли конфіг
    # справді інший: після ребуту (/etc у RAM заводський) чи нового
    # wifi.conf. Перезапуск самого компонента (кожен реліз) Wi-Fi не смикає.
    _want=$(printf 'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=0\ncountry=UA\n\n'; cat "$CONF")
    if pgrep -f "wpa_supplicant.*-i ?$IFACE" >/dev/null; then
        [ "$(sudo -n cat "$WPA" 2>/dev/null)" = "$_want" ] && return 0
        printf '%s\n' "$_want" | sudo -n tee "$WPA" >/dev/null && sudo -n chmod 600 "$WPA" || return 1
        sudo -n wpa_cli -i "$IFACE" reconfigure >/dev/null 2>&1 || return 1
    else
        printf '%s\n' "$_want" | sudo -n tee "$WPA" >/dev/null && sudo -n chmod 600 "$WPA" || return 1
        sudo -n wpa_supplicant -B -c "$WPA" -i "$IFACE" -Dnl80211,wext >/dev/null 2>&1 || return 1
    fi
}

# ── Wi-Fi є, а інтернету за ним нема ─────────────────────────────────────
# Точка доступу клубу жива й малина до неї підключена, але інтернет за нею
# лежить: маршрут wlan0 нікуди не дівається, і трафік ішов би в нікуди, поки
# LTE поруч простоює. Маршрутів dhcpcd не чіпаємо — він повернув би свої на
# першому ж поновленні оренди. Поверх них кладемо один свій: default через
# LTE з метрикою OVERRIDE, меншою за METRIC, і прибираємо його, щойно Wi-Fi
# знову везе. Перевіряємо саме через wlan0 (ping -I): ядро шукає маршрут лише
# серед тих, що йдуть через цей інтерфейс, тож інтернет за Wi-Fi видно й
# тоді, коли решта трафіку вже йде через LTE.
#
# Запас від перемикань туди-сюди: на LTE — після FAIL_AFTER невдалих
# перевірок поспіль (~1,5–2 хв), назад — після BACK_AFTER вдалих (~2,5 хв).
# Кожне перемикання рве відкриті з'єднання (тунель, вебсокет кіоска,
# заливку), тож хай краще рідко, ніж смикається.
#
# Під час зупинки свій маршрут не прибираємо: новий екземпляр (реліз
# перезапускає компоненти) підхоплює стан із таблиці маршрутів, а не кидає
# трафік на мертвий Wi-Fi ще на півтори хвилини. Ребут маршрут стирає.
OVERRIDE="${WIFI_OVERRIDE_METRIC:-50}"
FAIL_AFTER=3
BACK_AFTER=5
BAD=0; GOOD=0

# Адреси, а не імена: перевірка не має залежати від DNS.
wifi_online() {
    ping -I "$IFACE" -c 3 -W 2 -q 1.1.1.1 >/dev/null 2>&1 \
        || ping -I "$IFACE" -c 3 -W 2 -q 8.8.8.8 >/dev/null 2>&1
}
on_lte() { ip route show default | grep -qw "metric $OVERRIDE"; }
# Запасна дорога — default не через wlan0 і не наш: «<шлюз> <інтерфейс>».
lte_route() {
    ip route show default | awk -v i="$IFACE" -v o="$OVERRIDE" '
        $1 == "default" && $2 == "via" && $5 != i {
            for (k = 1; k < NF; k++) if ($k == "metric" && $(k + 1) == o) next
            print $3, $5; exit }'
}
to_lte() {
    set -- $(lte_route)
    if [ -z "${1:-}" ]; then say "інтернету через $IFACE нема, а запасної дороги теж — лишаю як є"; return 1; fi
    sudo -n ip route add default via "$1" dev "$2" metric "$OVERRIDE" || return 1
    log "інтернету через $IFACE нема ($FAIL_AFTER перевірки поспіль) — трафік через $2 ($1), Wi-Fi перевіряю далі"
}
to_wifi() {
    while on_lte; do sudo -n ip route del default metric "$OVERRIDE" || return 1; done
    log "$IFACE знову з інтернетом ($BACK_AFTER перевірок поспіль) — Wi-Fi знову перша дорога"
}
uplink_check() {
    # Запасна дорога зникла (LTE без зв'язку, dhcpcd прибрав його маршрут) —
    # наш маршрут тепер веде в нікуди; прибираємо, хай буде хоч Wi-Fi.
    if on_lte && [ -z "$(lte_route)" ]; then
        sudo -n ip route del default metric "$OVERRIDE" && log "запасної дороги вже нема — прибрав свій маршрут через неї"
    fi
    if wifi_online; then
        BAD=0; GOOD=$((GOOD + 1))
        if on_lte && [ "$GOOD" -ge "$BACK_AFTER" ]; then to_wifi; fi
    else
        GOOD=0; BAD=$((BAD + 1))
        if ! on_lte && [ "$BAD" -ge "$FAIL_AFTER" ]; then to_lte; fi
    fi
}

log "старт"
on_lte && log "трафік і далі через LTE (свій маршрут від минулого запуску) — повернуся на Wi-Fi, щойно він стабільно везе"
APPLIED=""
while [ "$STOPPING" = 0 ]; do
    if [ ! -f "$CONF" ]; then say "немає $CONF — Wi-Fi не налаштований (scripts/pi-wifi.sh)"; idle 300; continue; fi
    if [ ! -e "/sys/class/net/$IFACE" ]; then say "немає $IFACE — адаптер не вставлений"; APPLIED=""; idle 30; continue; fi
    # Застосовуємо заново, коли змінився файл або адаптер щойно з'явився.
    _sig=$(cksum < "$CONF")
    if [ "$APPLIED" != "$_sig" ]; then
        if apply; then APPLIED=$_sig; log "конфіг Wi-Fi застосовано до $IFACE (метрика $METRIC)"
        else say "не вдалось застосувати конфіг Wi-Fi до $IFACE"; idle 60; continue; fi
    fi
    _ssid=$(sudo -n wpa_cli -i "$IFACE" status 2>/dev/null | sed -n 's/^ssid=//p')
    _ip=$(ip -4 -o addr show "$IFACE" 2>/dev/null | awk '{print $4; exit}')
    # Сигнал — лише в рядку про зміну стану: say() глушить повтори за точним
    # текстом, а дБм гуляють щопівхвилини й засипали б журнал.
    if [ "$_ssid|$_ip" != "${STATE:-}" ]; then
        STATE="$_ssid|$_ip"
        _dbm=$(awk -v i="$IFACE:" '$1 == i { sub(/\./, "", $4); print $4 }' /proc/net/wireless 2>/dev/null)
        if [ -n "$_ssid" ] && [ -n "$_ip" ]; then log "$IFACE: «$_ssid», $_ip, сигнал ${_dbm:-?} дБм"
        elif [ -n "$_ssid" ]; then log "$IFACE: «$_ssid» без адреси — чекаю DHCP"
        else log "$IFACE: не підключено — шукаю мережу з $CONF"; fi
    fi
    # Без адреси на wlan0 перевіряти нічого: маршрут Wi-Fi dhcpcd уже прибрав,
    # і трафік і так іде через LTE.
    [ -n "$_ip" ] && uplink_check
    idle "${WIFI_PERIOD_S:-30}"
done
