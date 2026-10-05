#!/bin/sh
# extrovert-bridge.sh — міст eth0 + eth1 на точці (docs/raspberry-pi.md,
# «Термінал через малину»). На пристрої: /usr/local/sbin/extrovert-bridge.sh,
# запускає extrovert-bridge.service перед dhcpcd.
#
# Навіщо (05.10.2026): у 4G-роутера кав'ярні рівно один LAN-порт, а дротова
# мережа потрібна і малині, і платіжному терміналу. Малина з'єднує свій
# порт (eth0, у роутер) і USB-перехідник (eth1, у термінал) в один сегмент.
# Термінал бачить роутер напряму й бере адресу в нього, як і без малини:
# ні DHCP-сервера, ні NAT тут немає.
#
# Безпечність. На диску /etc/dhcpcd.conf лишається як є (eth0). Конфіг для
# мосту цей скрипт щоразу генерує в /run (tmpfs), і dhcpcd читає саме його
# (drop-in dhcpcd.service.d/extrovert-bridge.conf). Якщо міст не піднявся
# — у /run лягає копія звичайного конфігу, і малина в мережі через eth0, як
# до 05.10. Тож помилка тут не може залишити точку без мережі й без ssh.
# З вимкненим overlay так само: на картку скрипт нічого не пише.
#
# MAC мосту = MAC eth0: роутер бачить той самий пристрій і віддає малині ту
# саму адресу (у dhcpcd.conf стоїть clientid — ідентифікатор за MAC).

CONF=/etc/dhcpcd.conf
RUN=/run/dhcpcd.conf

log() { echo "extrovert-bridge: $*"; }

# Запасний варіант — звичайний конфіг. Лягає першим, тож dhcpcd стартує з
# робочим файлом, хоч би де скрипт обірвався.
cp "$CONF" "$RUN"

# eth0 (smsc95xx) сидить на USB і з'являється не першою секундою.
i=0
while [ ! -e /sys/class/net/eth0 ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
[ -e /sys/class/net/eth0 ] || { log "eth0 немає — мосту не буде"; exit 0; }

if ! ip link show br0 >/dev/null 2>&1; then
    ip link add br0 type bridge forward_delay 0 stp_state 0 || { log "міст не створився"; exit 0; }
fi
if ! { ip link set br0 address "$(cat /sys/class/net/eth0/address)" \
       && ip link set eth0 master br0 \
       && ip link set eth0 up \
       && ip link set br0 up; }; then
    log "eth0 не став у міст — працюємо без мосту"
    ip link set eth0 nomaster 2>/dev/null
    ip link del br0 2>/dev/null
    exit 0
fi

# Перехідник, якщо вже з'явився. Якщо ні — його додасть udev-правило
# 90-extrovert-bridge.rules, щойно він увімкнеться (і після перепідключення).
if [ -e /sys/class/net/eth1 ]; then
    ip link set eth1 master br0 && ip link set eth1 up
fi

# Адресу тепер бере міст, а не порти. Блок `interface eth0` (власні DNS)
# стає блоком `interface br0`.
{ echo "denyinterfaces eth0 eth1"; sed 's/^interface eth0$/interface br0/' "$CONF"; } > "$RUN"
log "міст піднято: $(ls /sys/class/net/br0/brif | tr '\n' ' ')"
