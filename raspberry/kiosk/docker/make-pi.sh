#!/bin/sh
# make-pi.sh — зібрати ARM-бінарник кіоска ТУТ, на ПК, у контейнері.
#
# Малина в коридорі має малювати меню, а не компілювати: `make pi` на ній
# забирає весь процесор на ~80 с, і рівно стільки смикається картинка на
# очах у клієнта. Тому збірка переїхала сюди, а на точку їде готовий архів
# релізу (docs/raspberry-pi.md §3).
#
# Це не крос-компіляція: всередині той самий Raspbian Stretch під armv6
# (pi.Dockerfile), тобто ті самі gcc 6.3 і glibc 2.24, що на пристрої.
# Розбіжність версій хедерів і символів — рівно те, через що крос-sysroot
# свого часу відхилили. Ціна — QEMU: збірка триває хвилини замість секунд,
# але процесор при цьому чужий, не той, що показує меню.
#
#   ./docker/make-pi.sh              # bin/kiosk
#   ./docker/make-pi.sh clean pi     # свої цілі make
#
# Образ збереться сам при першому запуску. Потрібен binfmt для armv6:
# Docker Desktop вмикає його сам, на голому Linux — пакет qemu-user-static.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
IMAGE=${IMAGE:-kiosk-pi-builder}

docker image inspect "$IMAGE" >/dev/null 2>&1 || {
    echo "== образу $IMAGE немає, збираю (перший раз — кілька хвилин)"
    docker build -t "$IMAGE" -f "$HERE/pi.Dockerfile" "$ROOT"
}

[ $# -gt 0 ] || set -- pi

# Тека монтується всередину, а не копіюється: bin/ лишається на ПК, звідки
# його бере raspberry/pi/stack/make-release.sh. MSYS_NO_PATHCONV — щоб Git Bash на
# Windows не переписав /work у C:\Program Files\Git\work.
MSYS_NO_PATHCONV=1 docker run --rm -v "$ROOT":/work -w /work "$IMAGE" make "$@"

BIN="$ROOT/bin/kiosk"
if [ -x "$BIN" ] && command -v file >/dev/null 2>&1; then
    file "$BIN" | grep -q ARM || {
        echo "✗ $BIN не ARM — зібралось не тим компілятором" >&2; exit 1; }
    echo "✓ $BIN — ARM, далі: raspberry/pi/stack/make-release.sh"
fi
