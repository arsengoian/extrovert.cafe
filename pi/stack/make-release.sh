#!/bin/sh
# make-release.sh — зібрати архів релізу й маніфест до нього.
#
# Запускати на ПК, після `pos-native/docker/make-pi.sh`: бінарник збирає
# контейнер із тим самим Raspbian Stretch під armv6, тож ARM-код є, а
# процесор малини вільний. На пристрої цей скрипт не запускається взагалі —
# там немає ні git, ні вихідників (docs/raspberry-pi.md §3).
#
#   ./make-release.sh                      # версія з дати й git-хеша
#   ./make-release.sh 2026.09.20-hotfix    # своя версія
#
# На виході в dist/:
#   <реліз>.tar.gz   — те, що качає апдейтер
#   manifest.json    — те, що він читає першим (release/url/sha256/size)
#
# Далі обидва файли кладуться в R2 під releases/pi/ (маніфест — ОСТАННІМ,
# інакше точка спробує скачати архів, якого ще немає).

set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)          # pi/
PROJECT=$(cd "$SRC/.." && pwd)                 # code/
NATIVE="$PROJECT/pos-native"
DIST="${DIST:-$PROJECT/dist}"
BASE_URL="${BASE_URL:-https://pos.extrovert.cafe/releases/pi}"

REL="${1:-}"
if [ -z "$REL" ]; then
    SHA=$(git -C "$PROJECT" rev-parse --short HEAD 2>/dev/null || echo nogit)
    REL="$(date '+%Y.%m.%d')-$SHA"
fi

BIN="$NATIVE/bin/pos-native-pi"
# Саме -f, а не -x: на теці Windows, змонтованій у Git Bash, біт виконання
# не зберігається, і перевірка на -x відмовляла б у цілком нормальному
# білді. Права виставляються нижче, уже в стейджі.
[ -f "$BIN" ] || { echo "нема $BIN — спершу: ./pos-native/docker/make-pi.sh" >&2; exit 1; }
# Перевірка, що бінарник справді під малину, а не десктопний: сплутати
# легко (обидва лежать у bin/), а помилка виявиться аж на точці.
if command -v file >/dev/null 2>&1; then
    file "$BIN" | grep -q "ARM" || { echo "$BIN не ARM — це не той бінарник" >&2; exit 1; }
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/bin" "$STAGE/assets" "$STAGE/stack"

cp -a "$BIN" "$STAGE/bin/"
chmod +x "$STAGE/bin/pos-native-pi"
cp -a "$NATIVE/assets/." "$STAGE/assets/"
cp -a "$SRC/stack/common.sh" "$SRC/stack/supervisor.sh" "$SRC/stack/updater.sh" \
      "$SRC/stack/components.conf" "$STAGE/stack/"
chmod +x "$STAGE/stack/"*.sh

cat > "$STAGE/release.json" <<EOF
{
  "release": "$REL",
  "created_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "built_on": "$(uname -m)",
  "git": "$(git -C "$PROJECT" rev-parse HEAD 2>/dev/null || echo unknown)"
}
EOF

mkdir -p "$DIST"
TAR="$DIST/$REL.tar.gz"
# Детермінований порядок файлів — щоб два прогони з того самого дерева
# давали той самий архів і sha256 можна було звіряти очима.
( cd "$STAGE" && find . -type f | LC_ALL=C sort | tar -czf "$TAR" -T - )

SUM=$(sha256sum "$TAR" | cut -d' ' -f1)
SIZE=$(wc -c < "$TAR" | tr -d ' ')

# Маніфест навмисно ПЛАСКИЙ: його читає updater.sh без jq (common.sh:
# json_get). Вкладені обʼєкти тут ламають розбір — не додавати.
cat > "$DIST/manifest.json" <<EOF
{
  "release": "$REL",
  "url": "$BASE_URL/$REL.tar.gz",
  "sha256": "$SUM",
  "size": $SIZE
}
EOF

echo "готово:"
echo "  $TAR  ($(( SIZE / 1024 )) КБ)"
echo "  $DIST/manifest.json"
echo
# Ключі до R2 лежать у pos/.env і на точку не потрапляють ніколи: пристрій
# стоїть у публічному коридорі, а бакет публічний лише на читання.
echo "далі: npm run release:push -w pos    (архів, потім маніфест)"
