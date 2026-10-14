#!/bin/sh
# patch-image.sh — правки кореня точки, які релізом не приїдуть
# (docs/raspberry-pi.md, «Як це ставилось»). Корінь під overlay пишеться лише
# так: картка в кардрідері ПК, свіжий знімок або сама картка. Скрипт
# Linux-ний — на Windows його запускає patch-card.ps1 у Docker:
#
#   # образ картки (знімок, зроблений щойно, а не старий!):
#   docker run --rm --privileged -v "D:/шлях/до/теки:/w" debian:bookworm \
#     sh /w/code/raspberry/pi/patch-image.sh /w/card.img
#
#   # уже змонтований корінь:
#   sudo sh raspberry/pi/patch-image.sh --root /mnt/root
#
# Що робить (14.10.2026; до того скрипт ставив міст — він у git-історії):
#   1. прибирає міст br0 — пережиток до світча (raspberry-pi.md, «Міст br0»):
#      dhcpcd знову читає /etc/dhcpcd.conf і бере eth0 напряму;
#   2. дописує в /etc/dhcpcd.conf блок wlan0 — Wi-Fi клубу першою дорогою
#      (metric 100) з тими самими власними DNS, що й eth0 («Wi-Fi клубу»);
#   3. вимикає вхід по SSH за паролем — малина тепер у Wi-Fi клубу поруч із
#      чужими пристроями, а самі ми ходимо лише за ключами («Секрети точки»).
#
# Повторний запуск нічого не ламає: кожен крок спершу дивиться, чи він уже
# зроблений.
set -eu

install_into() { # install_into <корінь>
    R=$1
    [ -f "$R/sbin/overlayRoot.sh" ] && [ -f "$R/etc/dhcpcd.conf" ] && [ -f "$R/etc/ssh/sshd_config" ] \
        || { echo "✗ $R не схожий на корінь точки (немає overlayRoot.sh, dhcpcd.conf чи sshd_config)" >&2; exit 1; }

    # 1. Міст. Сервіс мосту ніде не ввімкнений сам — його тягнув drop-in
    # dhcpcd (Wants=), — але про всяк випадок прибираємо й посилання на нього.
    for f in usr/local/sbin/extrovert-bridge.sh \
             etc/systemd/system/extrovert-bridge.service \
             etc/systemd/system/dhcpcd.service.d/extrovert-bridge.conf \
             etc/udev/rules.d/90-extrovert-bridge.rules; do
        if [ -e "$R/$f" ]; then rm -f "$R/$f"; echo "  − /$f"; fi
    done
    find "$R/etc/systemd/system" -lname '*extrovert-bridge.service' -print -delete | sed "s|^$R|  − |"
    rmdir "$R/etc/systemd/system/dhcpcd.service.d" 2>/dev/null || true

    # 2. dhcpcd: власні DNS на eth0 (у дуже старих знімках їх ще немає) і wlan0.
    if ! grep -q '^interface eth0$' "$R/etc/dhcpcd.conf"; then
        printf '\n# Власні DNS замість роутерових (raspberry/pi/dhcpcd.conf).\ninterface eth0\nstatic domain_name_servers=9.9.9.9 8.8.8.8\n' >> "$R/etc/dhcpcd.conf"
        echo "  + eth0: власні DNS у /etc/dhcpcd.conf"
    fi
    if ! grep -q '^interface wlan0$' "$R/etc/dhcpcd.conf"; then
        printf '\n# Wi-Fi клубу — перша дорога в інтернет, LTE через eth0 — запасна\n# (raspberry/pi/dhcpcd.conf, stack/wifi.sh).\ninterface wlan0\nmetric 100\nstatic domain_name_servers=9.9.9.9 8.8.8.8\n' >> "$R/etc/dhcpcd.conf"
        echo "  + wlan0: metric 100 і власні DNS у /etc/dhcpcd.conf"
    fi

    # 3. SSH лише за ключем. Міняємо перший рядок PasswordAuthentication
    # (у Stretch — закоментований `#PasswordAuthentication yes`), а якщо його
    # нема — ставимо на початок: дописаний у кінець він міг би опинитись
    # усередині блоку Match і діяти не на всіх.
    S="$R/etc/ssh/sshd_config"
    if grep -q '^PasswordAuthentication no$' "$S"; then
        :
    elif grep -q '^#\{0,1\}PasswordAuthentication ' "$S"; then
        sed -i '0,/^#\{0,1\}PasswordAuthentication .*/s//PasswordAuthentication no/' "$S"
        echo "  ~ sshd_config: PasswordAuthentication no"
    else
        sed -i '1i PasswordAuthentication no' "$S"
        echo "  + sshd_config: PasswordAuthentication no"
    fi

    echo "✓ корінь пропатчено: $R"
    echo "  мосту: $(ls "$R/usr/local/sbin/extrovert-bridge.sh" "$R/etc/systemd/system/extrovert-bridge.service" "$R/etc/systemd/system/dhcpcd.service.d/extrovert-bridge.conf" "$R/etc/udev/rules.d/90-extrovert-bridge.rules" 2>/dev/null | wc -l) файлів"
    echo "  dhcpcd.conf: $(grep -c '^interface ' "$R/etc/dhcpcd.conf") блоки interface ($(grep '^interface ' "$R/etc/dhcpcd.conf" | cut -d' ' -f2 | tr '\n' ' '))"
    echo "  sshd: $(grep '^PasswordAuthentication' "$S")"
}

if [ "${1:-}" = "--root" ]; then
    install_into "${2:?шлях до кореня}"
    exit 0
fi

IMG=${1:?використання: patch-image.sh <образ.img> | --root <шлях>}
[ -f "$IMG" ] || { echo "✗ немає $IMG" >&2; exit 1; }
MNT=$(mktemp -d)
trap 'umount "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true' EXIT

# Корінь — той Linux-розділ, де лежить overlayRoot.sh. Номер не вгадуємо:
# на NOOBS-розмітці він «дірчастий» (p7 на kyiv-01).
partx -g -o NR,START,SECTORS,TYPE "$IMG" | while read -r nr start sectors type; do
    [ "$type" = "0x83" ] || continue
    mount -o ro,noload,loop,offset=$((start * 512)),sizelimit=$((sectors * 512)) "$IMG" "$MNT" 2>/dev/null || continue
    if [ -f "$MNT/sbin/overlayRoot.sh" ]; then echo "$nr $start $sectors"; fi
    umount "$MNT"
done > "$MNT.root"
read -r NR START SECTORS < "$MNT.root" || { echo "✗ у $IMG не знайшовся корінь точки" >&2; rm -f "$MNT.root"; exit 1; }
rm -f "$MNT.root"
echo "корінь — розділ $NR"

mount -o loop,offset=$((START * 512)),sizelimit=$((SECTORS * 512)) "$IMG" "$MNT"
install_into "$MNT"
sync
umount "$MNT"
echo "✓ образ готовий: $IMG"
