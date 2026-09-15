#!/bin/sh
# install.sh — одноразова підготовка точки під керований стек.
# Запускати НА малині. Ідемпотентний: повторний запуск нічого не ламає.
#
#   ./install.sh                      # чиста установка, перший реліз далі привезе апдейтер
#   ./install.sh --adopt /home/pi/pos-native
#                                     # забрати вже встановлений кіоск як реліз 0
#
# Після цього все наше живе в /home/pi/extrovert. Поза нею лишається один
# файл — /etc/systemd/system/extrovert.service (його ставить цей скрипт).

set -eu
ROOT="${EXTROVERT_ROOT:-/home/pi/extrovert}"
HERE=$(cd "$(dirname "$0")" && pwd)
ADOPT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --adopt) ADOPT=${2:?потрібен шлях}; shift 2 ;;
        *) echo "невідомий аргумент: $1" >&2; exit 2 ;;
    esac
done

echo "== розкладка в $ROOT =="
mkdir -p "$ROOT/bin" "$ROOT/releases" "$ROOT/state" "$ROOT/logs" "$ROOT/config"

# Шими: стабільні шляхи, які знає systemd. Усередині — exec у поточний
# реліз. Самі шими не оновлюються ніколи, тому й лишаються короткими:
# усе, що може зламатись, живе в релізі й відкочується разом із ним.
cat > "$ROOT/bin/supervisor.sh" <<'SHIM'
#!/bin/sh
# Стабільна точка входу. Не редагувати: логіка — в current/stack/.
exec "${EXTROVERT_ROOT:-/home/pi/extrovert}/current/stack/supervisor.sh" "$@"
SHIM
chmod +x "$ROOT/bin/supervisor.sh"

if [ ! -f "$ROOT/config/env" ]; then
    cat > "$ROOT/config/env" <<ENV
# Конфіг точки. Переживає оновлення (лежить поза releases/).
POINT=kyiv-01
# URL=https://pos.extrovert.cafe/api/v1/points/\$POINT/menu
UPDATE_URL=https://pos.extrovert.cafe/releases/pi/manifest.json
UPDATE_PERIOD_S=900
POPUP=1
ENV
    echo "створено $ROOT/config/env — перевір POINT і UPDATE_URL"
fi

if [ -n "$ADOPT" ]; then
    REL="0000-adopted-$(date '+%Y%m%d')"
    echo "== забираю наявний кіоск з $ADOPT як реліз $REL =="
    [ -x "$ADOPT/bin/pos-native-pi" ] || { echo "нема $ADOPT/bin/pos-native-pi" >&2; exit 1; }
    mkdir -p "$ROOT/releases/$REL/bin" "$ROOT/releases/$REL/assets" "$ROOT/releases/$REL/stack"
    cp -a "$ADOPT/bin/pos-native-pi" "$ROOT/releases/$REL/bin/"
    cp -a "$ADOPT/assets/." "$ROOT/releases/$REL/assets/"
    cp -a "$HERE/common.sh" "$HERE/supervisor.sh" "$HERE/updater.sh" \
          "$HERE/components.conf" "$ROOT/releases/$REL/stack/"
    chmod +x "$ROOT/releases/$REL/stack/"*.sh
    ln -sfn "$ROOT/releases/$REL" "$ROOT/current.new"
    mv -Tf "$ROOT/current.new" "$ROOT/current"
    printf '%s\n' "$REL" > "$ROOT/state/version"
    echo "current → $REL"
fi

if [ ! -L "$ROOT/current" ]; then
    echo "!! $ROOT/current ще не вказує на реліз."
    echo "   Або запусти з --adopt <тека наявного pos-native>,"
    echo "   або розпакуй туди перший реліз руками:"
    echo "     mkdir -p $ROOT/releases/<реліз> && tar -xzf <архів> -C $ROOT/releases/<реліз>"
    echo "     ln -sfn $ROOT/releases/<реліз> $ROOT/current"
fi

echo "== systemd =="
if [ "$(id -u)" = "0" ]; then
    install -m 0644 "$HERE/extrovert.service" /etc/systemd/system/extrovert.service
    systemctl daemon-reload
    echo "юніт встановлено. Далі:"
else
    echo "потрібен root, щоб покласти юніт. Виконай:"
    echo "  sudo install -m 0644 $HERE/extrovert.service /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload"
fi
# Старий юніт мало вимкнути: `systemctl restart pos-native` (крон-сторож)
# піднімає й вимкнений юніт — і поруч зі стеком стартував би другий кіоск.
# `mask` тут не спрацює: файл юніта лежить у /etc/systemd/system, і systemd
# відмовляється підміняти його симлінком. Тому файл відкладаємо вбік —
# суфікс .off systemd не читає, а відкат — це `mv` назад.
cat <<'NEXT'
  sudo systemctl disable --now pos-native.service   # старий однокомпонентний юніт
  sudo mv /etc/systemd/system/pos-native.service /etc/systemd/system/pos-native.service.off
  sudo systemctl daemon-reload
  crontab -e   # рядок kiosk-watch замінити на stack-watch з pi/crontab
  sudo systemctl enable  --now extrovert.service
  journalctl -u extrovert -f
NEXT
