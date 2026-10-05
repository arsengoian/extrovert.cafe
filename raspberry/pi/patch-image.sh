#!/bin/sh
# patch-image.sh — ставить міст до платіжного терміналу в корінь точки
# (docs/raspberry-pi.md, «Термінал через малину»).
#
# Корінь на точці під overlay і пишеться лише так: картка в кардрідері ПК,
# свіжий знімок або сама картка. Скрипт Linux-ний — запускати в Docker чи WSL:
#
#   # образ картки (знімок, зроблений щойно, а не старий pi.img!):
#   docker run --rm --privileged -v "D:/шлях/до/теки:/w" debian:bookworm \
#     sh /w/code/raspberry/pi/patch-image.sh /w/card.img
#
#   # уже змонтований корінь (наприклад, wsl --mount … --partition 7):
#   sudo sh raspberry/pi/patch-image.sh --root /mnt/wsl/PHYSICALDRIVE2p7
#
# Повторний запуск нічого не ламає: файли перезаписуються тими самими.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)

install_into() { # install_into <корінь>
    R=$1
    [ -f "$R/sbin/overlayRoot.sh" ] && [ -f "$R/etc/dhcpcd.conf" ] \
        || { echo "✗ $R не схожий на корінь точки (немає overlayRoot.sh чи dhcpcd.conf)" >&2; exit 1; }
    install -m 755 -o root -g root "$HERE/extrovert-bridge.sh" "$R/usr/local/sbin/extrovert-bridge.sh"
    install -m 644 -o root -g root "$HERE/extrovert-bridge.service" "$R/etc/systemd/system/extrovert-bridge.service"
    install -d -m 755 "$R/etc/systemd/system/dhcpcd.service.d"
    install -m 644 -o root -g root "$HERE/dhcpcd-extrovert-bridge.conf" "$R/etc/systemd/system/dhcpcd.service.d/extrovert-bridge.conf"
    install -m 644 -o root -g root "$HERE/90-extrovert-bridge.rules" "$R/etc/udev/rules.d/90-extrovert-bridge.rules"
    # Власні DNS (26.09.2026) — блок, який міст переносить на br0. У старих
    # знімках його ще немає.
    if ! grep -q '^interface eth0$' "$R/etc/dhcpcd.conf"; then
        printf '\n# Власні DNS замість роутерових (raspberry/pi/dhcpcd.conf).\ninterface eth0\nstatic domain_name_servers=9.9.9.9 8.8.8.8\n' >> "$R/etc/dhcpcd.conf"
        echo "  + власні DNS у /etc/dhcpcd.conf"
    fi
    echo "✓ міст встановлено в $R"
    ls -la "$R/usr/local/sbin/extrovert-bridge.sh" "$R/etc/systemd/system/extrovert-bridge.service" \
           "$R/etc/systemd/system/dhcpcd.service.d/extrovert-bridge.conf" "$R/etc/udev/rules.d/90-extrovert-bridge.rules"
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
