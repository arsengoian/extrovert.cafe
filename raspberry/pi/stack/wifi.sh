#!/bin/sh
# wifi.sh — друга дорога в інтернет: Wi-Fi клубу через USB-адаптер
# (raspberry-pi.md, «Wi-Fi клубу»). Компонент стеку, як tunnel і uploader.
#
# Навіщо (14.10.2026): аплінк роутера LTE у клубі буває мертвий годинами —
# заливка рвалась, тунель падав, а з телефона в його мережі не відкривався
# навіть спідтест. Wi-Fi клубу тим часом працював. Тепер малина тримає обидві
# дороги: Wi-Fi — перша (менша метрика маршруту), LTE через br0 — запасна.
# Камера (Tapo C100 у Wi-Fi роутера LTE) лишається досяжною через br0: до її
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

# Конфіг, з яким dhcpcd справді запущений. На kyiv-01 це не /etc/dhcpcd.conf,
# а /run/dhcpcd.conf (-f): його генерує пережиток мосту (raspberry-pi.md,
# «Міст br0»). Після зняття мосту знову буде /etc — тому не зашиваємо.
dhcpcd_conf() {
    _pid=$(pgrep -o -x dhcpcd) || { echo /etc/dhcpcd.conf; return; }
    _f=$(tr '\0' '\n' < "/proc/$_pid/cmdline" 2>/dev/null | sed -n '/^-f$/{n;p;}')
    echo "${_f:-/etc/dhcpcd.conf}"
}

apply() {
    { printf 'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=0\ncountry=UA\n\n'
      cat "$CONF"; } | sudo -n tee "$WPA" >/dev/null || return 1
    sudo -n chmod 600 "$WPA"
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
    if pgrep -f "wpa_supplicant.*-i ?$IFACE" >/dev/null; then
        sudo -n wpa_cli -i "$IFACE" reconfigure >/dev/null 2>&1 || return 1
    else
        sudo -n wpa_supplicant -B -c "$WPA" -i "$IFACE" -Dnl80211,wext >/dev/null 2>&1 || return 1
    fi
}

log "старт"
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
    idle 30
done
