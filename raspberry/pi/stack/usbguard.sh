#!/bin/sh
# usbguard.sh — страховка для пробного режиму USB 1.1 (raspberry-pi.md,
# «USB 1.1 на Pi 1 B»). Компонент стеку, як wifi і tunnel.
#
# Навіщо (15.10.2026): на Pi 1 B Ethernet, Wi-Fi адаптер і флешка висять на
# одному USB-контролері dwc_otg, і його переривання на кожен мікрокадр USB
# 2.0 (~8000 за секунду, FIQ) з'їдають помітну частину єдиного ядра —
# заливці відео процесора вже не лишається. `dwc_otg.speed=1` у
# /boot/cmdline.txt переводить шину на USB 1.1 (кадр раз на мілісекунду),
# а нашим потокам (~1–3 Мбіт/с) 12 Мбіт/с вистачає. Але якщо Ethernet чи
# Wi-Fi адаптер на 1.1 не запрацюють, малина зникне з мережі, і відкотити
# зміг би лише хтось на місці. Тож пробу робимо зі сторожем: вмикаючи
# параметр, кладемо прапорець state/usb11.trial (розділ data, переживає
# ребут), а цей компонент після старту дає мережі GRACE_S секунд. Піднялось
# усе — прапорець знімає, режим лишається назавжди. Ні — прибирає параметр
# з cmdline.txt і перезавантажує малину: найгірший випадок — кілька хвилин
# без точки.
#
# /boot — окремий розділ FAT, записуваний і під overlay (§5), тож правка
# переживає ребут. Без прапорця компонент нічого не робить: постійний режим
# (і будь-яку ручну правку cmdline.txt) не чіпає.
set -u
LOG_TAG=usbguard
. "$(dirname "$0")/common.sh"

CMDLINE="${USBGUARD_CMDLINE:-/boot/cmdline.txt}"
TRIAL="$EXTROVERT_STATE/usb11.trial"
GRACE_S="${USBGUARD_GRACE_S:-300}"
API_HOST="${USBGUARD_API:-https://api.extrovert.cafe/}"

STOPPING=0
trap 'STOPPING=1' TERM INT
idle() { [ "$STOPPING" = 0 ] && nap "$1"; }   # одним sleep, див. nap у common.sh

has_param() { grep -qw 'dwc_otg.speed=1' "$CMDLINE" 2>/dev/null; }
has_v4() { ip -4 -o addr show dev "$1" 2>/dev/null | grep -q ' inet '; }
# Будь-яка HTTP-відповідь (і 404) означає, що до api дістались; 000 — ні.
api_ok() { [ "$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$API_HOST" 2>/dev/null)" != 000 ]; }
uptime_s() { awk '{ printf "%d", $1 }' /proc/uptime; }

# Що не так — порожньо, якщо все гаразд. Wi-Fi вимагаємо лише на точці, де
# він налаштований (config/wifi.conf): там він перша дорога в інтернет.
problems() {
    _p=""
    has_v4 eth0 || _p="$_p eth0 без адреси (Ethernet: LTE-роутер і камера);"
    if [ -f "$EXTROVERT_ROOT/config/wifi.conf" ]; then
        has_v4 wlan0 || _p="$_p wlan0 без адреси (Wi-Fi клубу);"
    fi
    api_ok || _p="$_p api недосяжний;"
    printf '%s' "$_p"
}

revert() { # revert <причина>
    log "USB 1.1 за ${GRACE_S} с після старту не піднявся:$1 — прибираю dwc_otg.speed=1 і перезавантажую"
    rm -f "$TRIAL"
    sudo -n sed -i 's/ *dwc_otg\.speed=1//g' "$CMDLINE" && sync
    if has_param; then log "не вдалось прибрати параметр із $CMDLINE — лишаю як є"; return 1; fi
    sudo -n reboot
}

log "старт"
if has_param && [ -f "$TRIAL" ]; then
    log "пробний режим USB 1.1: даю мережі до ${GRACE_S} с від старту"
    while [ "$STOPPING" = 0 ]; do
        _why=$(problems)
        if [ -z "$_why" ]; then
            rm -f "$TRIAL"
            log "USB 1.1 працює (аптайм $(uptime_s) с): eth0, wlan0 й api на місці — лишаю режим, прапорець знято"
            break
        fi
        if [ "$(uptime_s)" -ge "$GRACE_S" ]; then revert "$_why"; break; fi
        idle 15
    done
elif has_param; then
    log "USB 1.1 увімкнено без пробного прапорця — вважаю постійним, не втручаюсь"
fi
# Супервізор перезапускає компонент, що вийшов, тож далі просто живемо.
while [ "$STOPPING" = 0 ]; do idle 3600; done
