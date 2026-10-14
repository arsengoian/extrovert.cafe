#!/usr/bin/env bash
# Підключити малину до Wi-Fi: scripts/pi-wifi.sh [точка] [мережа]
#
# Друга дорога в інтернет поруч із роутером LTE (14.10.2026): мобільний
# аплінк у клубі буває мертвий годинами, а Wi-Fi клубу — ні. Адаптер —
# USB (D-Link DWA-125, RT3070), драйвер і прошивка вже є в образі.
#
# Пароль скрипт питає сам і не показує. На малину він іде через stdin ssh, а
# там wpa_passphrase робить із нього PSK-хеш: у config/wifi.conf лягає лише
# хеш — відкритого пароля немає ні на картці, ні в аргументах процесів, ні
# в історії оболонки. config/ — на розділі даних, тож переживає і ребут, і
# релізи; застосовує його компонент wifi (raspberry/pi/stack/wifi.sh).
#
# З PowerShell — через Git Bash явно: `bash` там часто означає WSL.
#   & "C:\Program Files\Git\bin\bash.exe" scripts/pi-wifi.sh kyiv-01 Arena
set -euo pipefail
cd "$(dirname "$0")/.."
POINT="${1:-kyiv-01}"
SSID="${2:-}"
[ -n "$SSID" ] || read -r -p "Мережа (SSID): " SSID
read -r -s -p "Пароль до «$SSID»: " PASS; echo
if [ ${#PASS} -lt 8 ] || [ ${#PASS} -gt 63 ]; then
    echo "✗ пароль WPA — від 8 до 63 символів" >&2; exit 1
fi
Q=$(printf '%q' "$SSID")
# sed прибирає коментарі wpa_passphrase — серед них і `#psk="<пароль>"`.
printf '%s\n' "$PASS" | bash scripts/pi-ssh.sh "$POINT" "umask 077
C=\$HOME/extrovert/config/wifi.conf
wpa_passphrase $Q | sed '/^[[:space:]]*#/d' > \$C.new
if grep -q '^[[:space:]]*psk=' \$C.new; then
    mv \$C.new \$C && touch \$HOME/extrovert/state/restart.wifi && echo '✓ збережено на малині (лише хеш пароля)'
else
    rm -f \$C.new; echo '✗ wpa_passphrase не дав ключа' >&2; exit 1
fi"
