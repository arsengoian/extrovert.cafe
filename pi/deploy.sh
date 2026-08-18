#!/usr/bin/env bash
# Викласти статику кіоска на Raspberry Pi і перезапустити браузер.
#
# Кіоск читає сторінку з локального сервера на самій малині (див. kiosk.sh),
# тому «деплой» = скопіювати три файли й перезапустити Chromium.
#
# Використання:
#   ./deploy.sh                        # pi@192.168.5.45, рівень анімацій за замовчанням
#   ./deploy.sh pi@10.0.0.5            # інша адреса
#   ANIM=4 HUD=1 ./deploy.sh           # прогін для заміру: усі анімації + лічильник fps
#   LEAN=1 ./deploy.sh                 # Chromium у режимі економії памʼяті (--single-process)
#
# Сторінка береться з локального сервера на самій малині, а не з Cloudflare:
# так можна ганяти правки без деплою у прод. Повернути прод — стерти
# /home/pi/kiosk.env і перезапустити kiosk.sh.
set -euo pipefail
HOST="${1:-pi@192.168.5.45}"
DEST="${DEST:-/home/pi/kiosk}"
SRC="$(cd "$(dirname "$0")/../pos/public" && pwd)"

ANIM="${ANIM:-}"; HUD="${HUD:-}"; GPU="${GPU:-}"
Q=""
[ -n "$ANIM" ] && Q="${Q}&anim=${ANIM}"
[ -n "$HUD"  ] && Q="${Q}&hud=${HUD}"
[ -n "$GPU"  ] && Q="${Q}&gpu=${GPU}"
[ -n "$Q" ] && Q="?${Q#&}"

POINT="${POINT:-kyiv-01}"
PRICES="$(cd "$(dirname "$0")/../pos/data" && pwd)/prices.json"

echo "== копіюю $SRC → $HOST:$DEST =="
ssh "$HOST" "mkdir -p '$DEST'"
if command -v rsync >/dev/null 2>&1; then
  rsync -av --delete --exclude 'api/' "$SRC/" "$HOST:$DEST/"
else
  scp -r "$SRC/." "$HOST:$DEST/"          # Windows/Git Bash без rsync
fi

# Локальний зліпок меню — ОБОВʼЯЗКОВО після rsync, інакше --delete його знесе.
# Без нього python3 -m http.server віддає 404 на /api/v1/points/<point>/menu,
# кіоск малює НУЛЬ карток — і замір fps показує порожню сторінку однаково
# швидкою на всіх рівнях анімацій. Тобто без цього файла крок 1 дає красиві
# цифри, які нічого не означають.
ssh "$HOST" "mkdir -p '$DEST/api/v1/points/$POINT'"
if [ -f "$PRICES" ]; then
  scp -q "$PRICES" "$HOST:$DEST/api/v1/points/$POINT/menu"
else
  echo "!! немає $PRICES — кіоск намалює порожню сітку, замір буде недійсний" >&2
fi

echo "== URL кіоска: http://localhost:8080/index.html$Q =="

# Скрипт їде на малину через stdin (`bash -s`), а не рядком в аргументі ssh.
# Це не косметика: при `ssh HOST "...pkill -f python3 -m http.server..."` увесь
# текст стає командним рядком віддаленого bash, і `pkill -f` знаходить у ньому
# власний шаблон — сесія вбивала сама себе, а через `set -e` решта блоку мовчки
# не виконувалась. Виглядало це як «деплой пройшов, а на екрані старе».
ssh "$HOST" bash -s <<REMOTE
set -e
# kiosk.sh бере URL зі змінної; підміняємо її, не чіпаючи сам скрипт
# Лапки навколо URL обовʼязкові. kiosk.sh робить \`. kiosk.env\`, а в рядку
# запиту є \`&\` — без лапок bash розуміє його як «запусти у фоні», присвоєння
# їде в підоболонку, і кіоск тихо відкриває прод замість локальної сторінки.
{
  echo "URL='http://localhost:8080/index.html$Q'"
  echo "LEAN='${LEAN:-0}'"
} > /home/pi/kiosk.env

pkill -f 'http.server 8080' 2>/dev/null || true
pkill -f 'kiosk.sh' 2>/dev/null || true
# comm обрізається до 15 символів ('chromium-browse'), тому -x не спрацює
pkill -f 'chromium-browser' 2>/dev/null || true
sleep 2

# </dev/null обовʼязковий: інакше фонові процеси тримають stdin ssh-сесії
# відкритим, і ssh не повертає керування — деплой «висить» до таймауту.
cd '$DEST' && nohup python3 -m http.server 8080 </dev/null >/dev/null 2>&1 &
sleep 1

# DISPLAY обовʼязковий: по ssh його немає, а kiosk.sh запускає Chromium і xset.
# Без нього браузер мовчки не стартує, і виглядає це як «деплой не доїхав».
DISPLAY=:0 nohup /home/pi/kiosk.sh </dev/null >/dev/null 2>&1 &
sleep 2
echo ok
exit 0
REMOTE
echo
echo "Готово. Якщо міряєш — відкрий екран малини і дивись HUD у правому верхньому куті."
