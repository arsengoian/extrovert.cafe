#!/bin/sh
# install.sh — одноразова підготовка точки під керований стек.
# Запускати НА малині. Ідемпотентний: повторний запуск нічого не ламає.
#
#   ./install.sh                      # чиста установка, перший реліз далі привезе апдейтер
#   ./install.sh --adopt /home/pi/pos-native
#                                     # забрати вже встановлений кіоск як реліз 0
#   ./install.sh --release /tmp/<реліз>.tar.gz
#                                     # поставити архів із make-release.sh руками —
#                                     # коли бакет недоступний (перший раз по SSH)
#
# Після цього все наше живе в /home/pi/extrovert. Поза нею лишається один
# файл — /etc/systemd/system/extrovert.service (його ставить цей скрипт).

set -eu
ROOT="${EXTROVERT_ROOT:-/home/pi/extrovert}"
HERE=$(cd "$(dirname "$0")" && pwd)
ADOPT=""
ARCHIVE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --adopt) ADOPT=${2:?потрібен шлях}; shift 2 ;;
        --release) ARCHIVE=${2:?потрібен архів}; shift 2 ;;
        *) echo "невідомий аргумент: $1" >&2; exit 2 ;;
    esac
done

# cec-utils — єдиний спосіб дізнатись, що монітор вимкнули кнопкою, і єдиний
# спосіб увімкнути його назад (docs/raspberry-pi.md §6-біс; перевірено на
# Asus VP227HF 24.09.2026). Без нього телеметрія чесно каже «не знаю»,
# тож установка не обовʼязкова — але без неї ми сліпі до сплячого екрана.
if ! command -v cec-client >/dev/null 2>&1; then
    echo "== ставлю cec-utils (стан монітора) =="
    sudo apt-get install -y --no-install-recommends cec-utils \
        || echo "   не вийшло — точка працюватиме, але стан монітора буде невідомий"
fi

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
# URL=https://pos.extrovert.cafe/points/\$POINT/menu.json
UPDATE_URL=https://pos.extrovert.cafe/releases/pi/manifest.json
UPDATE_PERIOD_S=120
POPUP=1
ENV
    echo "створено $ROOT/config/env — перевір POINT і UPDATE_URL"
fi

if [ -n "$ADOPT" ]; then
    REL="0000-adopted-$(date '+%Y%m%d')"
    echo "== забираю наявний кіоск з $ADOPT як реліз $REL =="
    # До 21.09.2026 бінарник звався pos-native-pi — саме таким він лежить
    # на пристроях, які ще не переходили на стек. У релізі він уже kiosk.
    OLD_BIN="$ADOPT/bin/kiosk"
    [ -x "$OLD_BIN" ] || OLD_BIN="$ADOPT/bin/pos-native-pi"
    [ -x "$OLD_BIN" ] || { echo "нема $ADOPT/bin/kiosk (чи pos-native-pi)" >&2; exit 1; }
    mkdir -p "$ROOT/releases/$REL/bin" "$ROOT/releases/$REL/assets" "$ROOT/releases/$REL/stack"
    cp -a "$OLD_BIN" "$ROOT/releases/$REL/bin/kiosk"
    cp -a "$ADOPT/assets/." "$ROOT/releases/$REL/assets/"
    cp -a "$HERE/common.sh" "$HERE/supervisor.sh" "$HERE/updater.sh" \
          "$HERE/components.conf" "$ROOT/releases/$REL/stack/"
    chmod +x "$ROOT/releases/$REL/stack/"*.sh
    ln -sfn "$ROOT/releases/$REL" "$ROOT/current.new"
    mv -Tf "$ROOT/current.new" "$ROOT/current"
    printf '%s\n' "$REL" > "$ROOT/state/version"
    echo "current → $REL"
fi

# Архів із make-release.sh — той самий, що апдейтер качає з бакета, тільки
# привезений scp. Selftest тут теж обов'язковий: екран зараз у старої
# версії, і битий реліз має відмовити до перемикання, а не після.
if [ -n "$ARCHIVE" ]; then
    REL=$(basename "$ARCHIVE" .tar.gz)
    echo "== ставлю реліз $REL з $ARCHIVE =="
    TMP="$ROOT/releases/.$REL.tmp"
    rm -rf "$TMP" && mkdir -p "$TMP"
    tar -xzf "$ARCHIVE" -C "$TMP"
    [ -f "$TMP/stack/components.conf" ] || { echo "в архіві нема stack/components.conf" >&2; rm -rf "$TMP"; exit 1; }
    chmod +x "$TMP/bin/kiosk" "$TMP/stack/"*.sh
    EXTROVERT_STATE="$ROOT/state" ASSETS="$TMP/assets" "$TMP/bin/kiosk" --selftest \
        || { echo "selftest провалено — реліз не ставлю" >&2; rm -rf "$TMP"; exit 1; }
    rm -rf "${ROOT:?}/releases/$REL" && mv "$TMP" "$ROOT/releases/$REL"
    PREV=""
    [ -L "$ROOT/current" ] && PREV=$(basename "$(readlink "$ROOT/current")")
    [ -n "$PREV" ] && [ "$PREV" != "$REL" ] && printf '%s\n' "$PREV" > "$ROOT/state/previous"
    ln -sfn "$ROOT/releases/$REL" "$ROOT/current.new"
    mv -Tf "$ROOT/current.new" "$ROOT/current"
    printf '%s\n' "$REL" > "$ROOT/state/version"
    echo "current → $REL${PREV:+ (попередній: $PREV)}"
fi

if [ ! -L "$ROOT/current" ]; then
    echo "!! $ROOT/current ще не вказує на реліз."
    echo "   Запусти з --release <архів> або --adopt <тека старого кіоска>."
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
# Якщо на пристрої ще живе старий однокомпонентний pos-native.service (так
# було на kyiv-01 до 21.09.2026), його треба прибрати ДО старту стеку:
#   sudo systemctl disable --now pos-native.service
#   sudo rm /etc/systemd/system/pos-native.service && sudo systemctl daemon-reload
# і старий крон-рядок kiosk-watch — `systemctl restart` піднімає навіть
# вимкнений юніт, і поруч зі стеком стартував би другий кіоск.
cat <<'NEXT'
  crontab -e   # рядок stack-watch з raspberry/pi/crontab
  sudo systemctl enable --now extrovert.service
  journalctl -u extrovert -f
NEXT
