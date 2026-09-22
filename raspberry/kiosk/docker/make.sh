#!/bin/bash
# Запускає команду всередині контейнера-білдера з живим томом raspberry/kiosk/
# на /work — правка коду одразу видна контейнеру, без перезбірки образу.
#
#   docker/make.sh                    # make desktop
#   docker/make.sh make clean desktop # довільна ціль
#   docker/make.sh bash               # інтерактивна оболонка всередині (додай -it сам)
#
# MSYS_NO_PATHCONV=1 — інакше Git Bash на Windows намагається перетворити
# "/work" (шлях УСЕРЕДИНІ контейнера, не хоста) і ламає монтування; на
# звичайному Linux/Mac цей env просто ігнорується.
set -e
cd "$(dirname "$0")/.."
if [ $# -eq 0 ]; then set -- make desktop; fi
MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(pwd):/work" -w /work \
    kiosk-desktop-builder \
    "$@"
